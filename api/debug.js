// Debug endpoint to inspect stored log files and last entries.
// GET /api/debug returns JSON with counts, last entries, and file metadata.

import fs from 'fs/promises';
import path from 'path';

const BASE = './logs';
const FILES = {
  received: path.join(BASE, 'received.json'),
  visits: path.join(BASE, 'visits.json'),
  legacy: path.join(BASE, 'logs.json')
};

async function readJsonSafe(file) {
  try {
    const txt = await fs.readFile(file, 'utf8');
    return JSON.parse(txt || '[]');
  } catch (e) {
    return null;
  }
}

async function statSafe(file) {
  try {
    const s = await fs.stat(file);
    return { size: s.size, mtime: s.mtime.toISOString() };
  } catch (e) {
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const out = {};
  for (const [k, p] of Object.entries(FILES)) {
    out[k] = {};
    out[k].stat = await statSafe(p);
    out[k].data = await readJsonSafe(p);
    if (Array.isArray(out[k].data)) {
      out[k].count = out[k].data.length;
      out[k].last = out[k].data[0] || null;
    } else {
      out[k].count = null;
      out[k].last = null;
    }
    // don't include full data by default to avoid huge payloads
    if (req.query?.full === '1') out[k].all = out[k].data;
    delete out[k].data;
  }

  // include some env hints (non-secret)
  out.env = {
    hasLogForwardUrl: Boolean(process.env.LOG_FORWARD_URL),
    hasLogForwardKey: Boolean(process.env.LOG_FORWARD_KEY),
    logReceiverName: process.env.LOG_RECEIVER_NAME || null
  };

  return res.status(200).json(out);
}
