import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

test('runnable webhook receiver validates signatures and timestamps and deduplicates durably after restart', async t => {
  const dir = await mkdtemp(resolve('artifacts/webhook-example-'));
  const probe = createServer(); probe.listen(0, '127.0.0.1'); await new Promise(r => probe.once('listening', r)); const port = probe.address().port; await new Promise(r => probe.close(r));
  const secret = 'whsec_' + randomBytes(32).toString('base64'), state = join(dir, 'received.sqlite');
  let child;
  const start = async () => {
    child = spawn(process.execPath, ['examples/webhook-receiver.mjs'], { cwd: resolve('.'), windowsHide: true, env: { ...process.env, PORT: String(port), WEBHOOK_SECRET: secret, WEBHOOK_STATE: state }, stdio: ['ignore', 'pipe', 'pipe'] });
    await new Promise((yes, no) => {
      const timer = setTimeout(() => no(new Error('Receiver startup timed out')), 5000);
      child.stdout.on('data', data => { if (data.toString().includes('listening')) { clearTimeout(timer); yes(); } });
      child.once('error', error => { clearTimeout(timer); no(error); });
      child.once('exit', code => { clearTimeout(timer); if (code) no(new Error('Receiver exited with code ' + code)); });
    });
  };
  const stop = async () => { if (child?.exitCode === null && child?.signalCode === null) { const exited = new Promise(r => child.once('exit', r)); child.kill(); await exited; } };
  t.after(stop); await start();
  const id = randomUUID(), payload = JSON.stringify({ id: 1, type: 'item.created', item_id: randomUUID(), created_at: new Date().toISOString() });
  const send = (timestamp = String(Math.floor(Date.now() / 1000)), invalid = false) => {
    const signature = createHmac('sha256', Buffer.from(secret.slice(6), 'base64')).update(`${id}.${timestamp}.${payload}`).digest('base64');
    return fetch(`http://127.0.0.1:${port}/events`, { method: 'POST', headers: { 'webhook-id': id, 'webhook-timestamp': timestamp, 'webhook-signature': invalid ? 'v1,wrong' : 'v1,' + signature }, body: payload });
  };
  assert.equal((await send(undefined, true)).status, 401);
  assert.equal((await send('1')).status, 401);
  assert.equal((await send()).status, 204); assert.equal((await send()).status, 204);
  await stop(); await start(); assert.equal((await send()).status, 204); await stop();
  const db = new DatabaseSync(state, { readOnly: true });
  try { assert.equal(db.prepare('SELECT count(*) n FROM received').get().n, 1); assert.equal(db.prepare('SELECT payload FROM received').get().payload, payload); }
  finally { db.close(); }
});
