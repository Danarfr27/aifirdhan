// Simple logs API: GET returns logs stored in `logs/logs.json`.
// Optional protection: set `LOG_VIEW_KEY` in environment and pass `?key=...`.

import fs from 'fs/promises';

// Prefer the received logs (forwarded from chatbot). Fall back to legacy `logs.json`.
const PRIMARY_LOGS = './logs/received.json';
const FALLBACK_LOGS = './logs/logs.json';

export default async function handler(req, res) {
  // Allow only GET
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const requiredKey = process.env.LOG_VIEW_KEY;
  const provided = req.query?.key || (req.headers['x-log-key']);
  if (requiredKey && provided !== requiredKey) {
    return res.status(401).json({ error: 'Missing or invalid key' });
  }

  try {
    let raw = '[]';
    try {
      raw = await fs.readFile(PRIMARY_LOGS, 'utf8');
    } catch (e) {
      // if primary missing, try fallback
      try { raw = await fs.readFile(FALLBACK_LOGS, 'utf8'); } catch (e2) { raw = '[]' }
    }
    const all = JSON.parse(raw || '[]');

    // Support simple query params: limit, q (search id or country)
    const limit = Math.min(1000, parseInt(req.query?.limit || '100', 10) || 100);
    const q = (req.query?.q || '').toLowerCase();

    let filtered = all;
    if (q) {
      filtered = all.filter(e => {
        return (
          (e.id && e.id.toLowerCase().includes(q)) ||
          (e.ip && e.ip.includes(q)) ||
          (e.geo && ((e.geo.country||'').toLowerCase().includes(q) || (e.geo.city||'').toLowerCase().includes(q))) ||
          (e.request && e.request.contents && JSON.stringify(e.request.contents).toLowerCase().includes(q))
        );
      });
    }

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(filtered.slice(0, limit));
  } catch (e) {
    return res.status(200).json([]);
  }
}
