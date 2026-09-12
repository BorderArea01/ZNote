// Run: $env:WEBHOOK_SECRET='whsec_...'; node examples/webhook-receiver.mjs
// Configure http://localhost:4000/events in ZNote settings.
import { createServer } from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';

const secret = process.env.WEBHOOK_SECRET;
if (!secret?.startsWith('whsec_')) throw new Error('Set WEBHOOK_SECRET to the secret shown when creating a subscription');
const db = new DatabaseSync(resolve(process.env.WEBHOOK_STATE || 'webhook-receiver.sqlite'));
db.exec('CREATE TABLE IF NOT EXISTS received (id TEXT PRIMARY KEY, payload TEXT NOT NULL, received_at TEXT NOT NULL)');
const server = createServer(async (req, res) => {
  if (req.method !== 'POST' || req.url !== '/events') { res.writeHead(404).end(); return; }
  try {
    let buffer = Buffer.alloc(0);
    for await (const chunk of req) {
      if (buffer.length + chunk.length > 65536) { res.writeHead(413).end(); req.destroy(); return; }
      buffer = Buffer.concat([buffer, chunk]);
    }
    const id = req.headers['webhook-id'], timestamp = req.headers['webhook-timestamp'];
    if (typeof id !== 'string' || typeof timestamp !== 'string' || !/^\d+$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) { res.writeHead(401).end(); return; }
    const digest = createHmac('sha256', Buffer.from(secret.slice(6), 'base64')).update(`${id}.${timestamp}.${buffer.toString()}`).digest('base64');
    const actual = Buffer.from(req.headers['webhook-signature'] || ''), expected = Buffer.from('v1,' + digest);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) { res.writeHead(401).end(); return; }
    JSON.parse(buffer.toString());
    const result = db.prepare('INSERT OR IGNORE INTO received VALUES(?,?,?)').run(id, buffer.toString(), new Date().toISOString());
    // Durable acknowledgement. Add your own worker to consume the received table.
    if (result.changes) console.log('Stored event delivery', id);
    res.writeHead(204).end();
  } catch { res.writeHead(400).end(); }
});
server.listen(Number(process.env.PORT || 4000), '127.0.0.1', () => console.log('Webhook receiver listening on localhost:' + (process.env.PORT || 4000)));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => { db.close(); process.exit(0); }));
