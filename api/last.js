// Return the last received log entry quickly (protected by LOG_VIEW_KEY if set)
import fs from 'fs/promises';
import path from 'path';

const STORE_FILE = path.join('./logs','received.json');

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const viewKey = (process.env.LOG_VIEW_KEY || '').trim();
  if (viewKey) {
    const provided = req.query?.key || req.headers['x-log-view-key'] || req.headers['x-log-key'];
    if (!provided || provided !== viewKey) return res.status(401).json({ error: 'Missing or invalid view key' });
  }
  try {
    const txt = await fs.readFile(STORE_FILE, 'utf8');
    const list = JSON.parse(txt || '[]');
    return res.status(200).json(list[0] || null);
  } catch (e) {
    return res.status(200).json(null);
  }
}
