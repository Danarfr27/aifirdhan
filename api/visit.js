// Simple redirect tracker
// GET /api/visit?u=<url>&label=...  -> logs the click and redirects to `u` (if valid origin or absolute URL)

import fs from 'fs/promises';
import path from 'path';

const STORE_DIR = './logs';
const VISITS_FILE = path.join(STORE_DIR, 'visits.json');

async function ensureStore() {
  await fs.mkdir(STORE_DIR, { recursive: true });
  try {
    await fs.access(VISITS_FILE);
  } catch (e) {
    await fs.writeFile(VISITS_FILE, '[]', 'utf8');
  }
}

function isSafeUrl(url) {
  try {
    const u = new URL(url);
    // Allow http and https only
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch (e) {
    return false;
  }
}

export default async function handler(req, res) {
  await ensureStore();

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).send('Method not allowed');
  }

  const target = req.query?.u || req.query?.url;
  const label = req.query?.label || null;

  if (!target || !isSafeUrl(target)) {
    return res.status(400).send('Missing or invalid target URL');
  }

  try {
    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2,9)}`,
      timestamp: new Date().toISOString(),
      target,
      label,
      ip: req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(',')[0].trim() : (req.socket?.remoteAddress || null),
      userAgent: req.headers['user-agent'] || null,
      referer: req.headers['referer'] || req.headers['referrer'] || null,
      receivedBy: process.env.LOG_RECEIVER_NAME || 'logswormhistory'
    };

    const txt = await fs.readFile(VISITS_FILE, 'utf8');
    const list = JSON.parse(txt || '[]');
    list.unshift(entry);
    await fs.writeFile(VISITS_FILE, JSON.stringify(list.slice(0, 2000), null, 2), 'utf8');

    // optional receiver forwarding: if configured, also send visit to LOG_FORWARD_URL
    if (process.env.LOG_FORWARD_URL) {
      try {
        const headers = { 'Content-Type': 'application/json' };
        if (process.env.LOG_FORWARD_KEY) headers['x-log-forward-key'] = process.env.LOG_FORWARD_KEY;
        await fetch(process.env.LOG_FORWARD_URL, { method: 'POST', headers, body: JSON.stringify({ type: 'visit', entry }) });
      } catch (e) {
        console.warn('Forward visit failed', e);
      }
    }

    // redirect
    res.writeHead(302, { Location: target });
    return res.end();
  } catch (e) {
    console.error('Visit log failed', e);
    return res.status(500).send('Server error');
  }
}
