// Serverless function for Vercel with API Key Rotation Strategy
// Supports fallback to multiple keys if one hits Rate Limit (429)

import fs from 'fs/promises';

const LOGS_PATH = './logs/logs.json';
const GEO_IP_URL = (ip) => `http://ip-api.com/json/${ip}?fields=status,country,regionName,city,lat,lon,query,message,isp,org`;

function getRequesterIp(req) {
  const forwarded = req.headers['x-forwarded-for'] || req.headers['cf-connecting-ip'] || req.headers['x-real-ip'];
  if (forwarded) return forwarded.split(',')[0].trim();
  if (req.socket && req.socket.remoteAddress) return req.socket.remoteAddress;
  return '';
}

function makeId() {
  try {
    if (globalThis && typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  } catch (e) {}
  return `${Date.now()}-${Math.random().toString(36).slice(2,9)}`;
}

async function lookupGeo(ip) {
  if (!ip) return null;
  try {
    const r = await fetch(GEO_IP_URL(ip));
    if (!r.ok) return null;
    const data = await r.json();
    if (data.status !== 'success') return null;
    return data;
  } catch (e) {
    return null;
  }
}

// Try to extract readable text from the model response object.
function extractTextFromResponse(obj, maxLen = 8000) {
  const parts = [];
  const seen = new Set();
  function walk(node) {
    if (!node || parts.join('').length > maxLen) return;
    if (typeof node === 'string') {
      parts.push(node);
      return;
    }
    if (Array.isArray(node)) {
      for (const v of node) walk(v);
      return;
    }
    if (typeof node === 'object') {
      // prefer common fields
      const keys = ['text','content','output','message','response','candidates','outputs','results','items'];
      for (const k of keys) {
        if (node[k]) walk(node[k]);
      }
      // fallback to all values
      for (const v of Object.values(node)) walk(v);
    }
  }
  try { walk(obj); } catch (e) { /* ignore */ }
  return parts.join(' ').slice(0, maxLen).trim();
}

async function appendLog(entry) {
  try {
    await fs.mkdir('./logs', { recursive: true });
    let existing = [];
    try {
      const txt = await fs.readFile(LOGS_PATH, 'utf8');
      existing = JSON.parse(txt || '[]');
    } catch (e) {
      existing = [];
    }
    existing.unshift(entry);
    // Keep latest 1000 records to avoid unbounded growth
    await fs.writeFile(LOGS_PATH, JSON.stringify(existing.slice(0, 1000), null, 2), 'utf8');
  } catch (e) {
    console.error('Failed to write log', e);
  }
}

async function forwardLog(entry) {
  const forwardUrl = (process.env.LOG_FORWARD_URL || '').trim();
  if (!forwardUrl) return;
  try {
    const url = forwardUrl; // send to full url configured by user
    const headers = { 'Content-Type': 'application/json' };
    if (process.env.LOG_FORWARD_KEY) headers['x-log-forward-key'] = process.env.LOG_FORWARD_KEY;
    // best-effort, do not block main response if fails
    await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(entry),
      // short timeout by racing with a timer
    });
  } catch (e) {
    console.error('Forwarding log failed', e);
  }
}

export default async function handler(req, res) {
  // 1. Validasi Method
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // 2. Ambil Data Body
  const { contents } = req.body;
  if (!contents) {
    return res.status(400).json({ error: 'Body "contents" is required' });
  }

  // 3. Konfigurasi Kunci & Model
  // Ambil semua key dari .env dan pisahkan berdasarkan koma
  const keysString = process.env.GEMINI_API_KEYS || process.env.GENERATIVE_API_KEY || '';
  const apiKeys = keysString.split(',').filter(k => k.trim().length > 0);
  
  // Default ke 1.5-flash jika env tidak diisi (karena 2.5 belum rilis publik saat ini)
  const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

  if (apiKeys.length === 0) {
    console.error('Missing GEMINI_API_KEYS environment variable');
    return res.status(500).json({ error: 'Server configuration error: No API keys found.' });
  }

  // 4. Logika Rotasi Key (Failover)
  let lastError = null;
  let success = false;
  let finalData = null;

  // Loop mencoba setiap key yang ada
  for (let i = 0; i < apiKeys.length; i++) {
    const currentKey = apiKeys[i].trim();
    const externalApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${currentKey}`;

    try {
      // console.log(`[Attempt] Using Key Index: ${i} for Model: ${GEMINI_MODEL}`); // Uncomment untuk debug

      const response = await fetch(externalApiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents })
      });

      // Jika Sukses (200 OK)
      if (response.ok) {
        finalData = await response.json();
        success = true;
        break; // KELUAR dari loop, kita sudah dapat datanya
      }

      // Jika Error 429 (Rate Limit / Kuota Habis)
      if (response.status === 429) {
        console.warn(`[Limit] Key ke-${i + 1} habis (429). Mencoba key berikutnya...`);
        lastError = { status: 429, message: 'Rate limit exceeded' };
        continue; // LANJUT ke iterasi loop berikutnya (Key selanjutnya)
      }

      // Jika Error Lain (Misal 400 Bad Request karena prompt salah)
      // Biasanya tidak perlu ganti key, karena salahnya di input user
      const errorData = await response.json();
      console.error(`[API Error] Key ${i}:`, errorData);
      lastError = { status: response.status, details: errorData };
      break; // Stop mencoba, karena ini bukan masalah kuota

    } catch (error) {
      console.error(`[Network Error] Key ${i}:`, error);
      lastError = { status: 500, message: 'Internal Network Error' };
      // Jika error koneksi, lanjut coba key berikutnya
    }
  }
  
  // 5. Kirim Response Akhir ke User
  if (success && finalData) {
    // Try to log the request and response asynchronously (await so it's attempted)
    try {
      const ip = getRequesterIp(req);
      const geo = await lookupGeo(ip).catch(() => null);
      const responseText = extractTextFromResponse(finalData);

      const entry = {
        id: makeId(),
        timestamp: new Date().toISOString(),
        ip: ip || null,
        network: {
          userAgent: req.headers['user-agent'] || null,
          via: req.headers['via'] || null,
          forwarded: req.headers['forwarded'] || null,
          referer: req.headers['referer'] || req.headers['referrer'] || null
        },
        geo: geo || null,
        provider: (geo && (geo.isp || geo.org)) || null,
        request: {
          contents
        },
        // include readable assistant reply and the full raw response for debugging
        responseText: responseText || null,
        responseFull: finalData,
        responseSummary: {
          truncated: JSON.stringify(finalData).slice(0, 1000)
        }
      };
      await appendLog(entry);
      // forward to remote logs receiver (best-effort)
      await forwardLog(entry);
    } catch (e) {
      console.error('Logging failed', e);
    }

    return res.status(200).json(finalData);
  } else {
    // Jika semua key sudah dicoba dan gagal semua
    return res.status(lastError?.status || 500).json({
      error: 'Generation failed',
      message: 'Semua API Key sedang sibuk atau bermasalah.',
      details: lastError
    });
  }
}

