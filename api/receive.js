// Endpoint to receive forwarded logs and to list received logs.
// POST /api/receive  -> accepts JSON body (log entry). If LOG_FORWARD_KEY is set, requires header 'x-log-forward-key' to match.
// GET  /api/receive  -> returns received logs (protected by LOG_VIEW_KEY if set).

import fs from 'fs/promises';
import path from 'path';

const STORE_DIR = './logs';
const STORE_FILE = path.join(STORE_DIR, 'received.json');

async function ensureStore() {
  await fs.mkdir(STORE_DIR, { recursive: true });
  try {
    await fs.access(STORE_FILE);
  } catch (e) {
    await fs.writeFile(STORE_FILE, '[]', 'utf8');
  }
}

export default async function handler(req, res) {
  await ensureStore();

  if (req.method === 'POST') {
    // verify forward key if configured
    const configuredKey = (process.env.LOG_FORWARD_KEY || '').trim();
    if (configuredKey) {
      const provided = req.headers['x-log-forward-key'] || req.headers['x-log-key'];
      if (!provided || provided !== configuredKey) {
        return res.status(401).json({ error: 'Missing or invalid forward key' });
      }
    }

    try {
      const entry = req.body;
      if (!entry) return res.status(400).json({ error: 'Missing JSON body' });

      // enrich with receiver timestamp and source indicator
      entry._receivedAt = new Date().toISOString();
      entry._receivedBy = process.env.LOG_RECEIVER_NAME || 'logswormhistory';

      const txt = await fs.readFile(STORE_FILE, 'utf8');
      const list = JSON.parse(txt || '[]');
      list.unshift(entry);
      // keep most recent 5000 to limit growth
      await fs.writeFile(STORE_FILE, JSON.stringify(list.slice(0, 5000), null, 2), 'utf8');
      return res.status(200).json({ ok: true });
    } catch (e) {
      console.error('Receive failed', e);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  if (req.method === 'GET') {
    // protect viewing with LOG_VIEW_KEY if set
    const viewKey = (process.env.LOG_VIEW_KEY || '').trim();
    if (viewKey) {
      const provided = req.query?.key || req.headers['x-log-view-key'] || req.headers['x-log-key'];
      if (!provided || provided !== viewKey) {
        return res.status(401).json({ error: 'Missing or invalid view key' });
      }
    }

    try {
      const txt = await fs.readFile(STORE_FILE, 'utf8');
      const list = JSON.parse(txt || '[]');
      const limit = Math.min(2000, parseInt(req.query?.limit || '500', 10) || 500);
      return res.status(200).json(list.slice(0, limit));
    } catch (e) {
      return res.status(200).json([]);
    }
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
}
