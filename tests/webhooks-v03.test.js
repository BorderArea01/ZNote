import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHmac } from 'node:crypto';
import { createApp } from '../server/app.js';

test('webhooks sign durable events, retry failures, persist across restart, pause and allow manual redelivery', async t => {
  const dir = await mkdtemp(resolve('artifacts/webhooks-api-'));
  let clock = Date.now(), responseStatus = 503; const received = [];
  const receiver = createServer(async (req, res) => { let body = ''; for await (const chunk of req) body += chunk; received.push({ headers: req.headers, body }); res.writeHead(responseStatus).end(); });
  receiver.listen(0, '127.0.0.1'); await new Promise(r => receiver.once('listening', r));
  const endpoint = `http://127.0.0.1:${receiver.address().port}/events`;
  let runtime = createApp({ dataDir: dir, webhookOptions: { now: () => clock, timeoutMs: 50 } });
  let server = runtime.app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  let base = `http://127.0.0.1:${server.address().port}`;
  const setup = await fetch(base + '/api/auth/setup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: '0048' }) });
  let cookie = setup.headers.get('set-cookie').split(';')[0];
  const request = (path, method = 'GET', data) => fetch(base + path, { method, headers: { Cookie: cookie, ...(data ? { 'content-type': 'application/json' } : {}) }, body: data ? JSON.stringify(data) : undefined });
  const json = async (path, method, data) => { const r = await request(path, method, data); assert.ok(r.ok, await r.clone().text()); return r.json(); };
  t.after(async () => { await runtime.webhooks.stop(); await runtime.backups.stop(); await new Promise(r => server.close(r)); runtime.db.close(); await new Promise(r => receiver.close(r)); });
  let hook, note, delivery;
  await t.test('subscription sends only future selected events with independently verifiable signatures', async () => {
    await json('/api/items', 'POST', { title: '订阅以前的内容' });
    hook = await json('/api/webhooks', 'POST', { name: '测试接收器', url: endpoint, events: ['item.created'] });
    assert.ok(hook.secret.startsWith('whsec_'));
    assert.ok(!(await json('/api/webhooks'))[0].secret);
    note = await json('/api/items', 'POST', { title: '订阅后内容' });
    await runtime.webhooks.tick(); assert.equal(received.length, 1);
    const message = received[0]; assert.equal(JSON.parse(message.body).item_id, note.id);
    const signed = `${message.headers['webhook-id']}.${message.headers['webhook-timestamp']}.${message.body}`;
    assert.equal(message.headers['webhook-signature'], 'v1,' + createHmac('sha256', Buffer.from(hook.secret.slice(6), 'base64')).update(signed).digest('base64'));
    delivery = (await json(`/api/webhooks/${hook.id}/deliveries`)).items[0];
    assert.equal(delivery.status, 'pending'); assert.equal(delivery.attempts, 1); assert.equal(delivery.last_status, 503);
    assert.ok(delivery.next_attempt > clock);
    await json('/api/items/' + note.id, 'PATCH', { version: note.version, title: '更新不在订阅类型中' });
    await runtime.webhooks.tick(); assert.equal(received.length, 1);
  });
  await t.test('due retry preserves delivery ID and body, then confirms success', async () => {
    responseStatus = 204; clock = delivery.next_attempt + 1;
    await runtime.webhooks.tick(); assert.equal(received.length, 2);
    assert.equal(received[0].headers['webhook-id'], received[1].headers['webhook-id']); assert.equal(received[0].body, received[1].body);
    delivery = (await json(`/api/webhooks/${hook.id}/deliveries`)).items[0]; assert.equal(delivery.status, 'delivered'); assert.equal(delivery.attempts, 2);
    await runtime.webhooks.tick(); assert.equal(received.length, 2);
  });
  await t.test('paused subscriptions do not send; reenabled subscriptions resume pending events', async () => {
    await json('/api/webhooks/' + hook.id, 'PATCH', { enabled: false });
    await json('/api/items', 'POST', { title: '暂停期间产生的事件' });
    await runtime.webhooks.tick(); assert.equal(received.length, 2);
    await json('/api/webhooks/' + hook.id, 'PATCH', { enabled: true });
    await runtime.webhooks.tick(); assert.equal(received.length, 3);
  });
  await t.test('retry exhaustion is visible, manual retry survives process restart and succeeds', async () => {
    responseStatus = 500; await json('/api/items', 'POST', { title: '需要持续重试' });
    for (let i = 0; i < 8; i++) { clock += 3600001; await runtime.webhooks.tick(); }
    const failed = (await json(`/api/webhooks/${hook.id}/deliveries`)).items.find(i => i.status === 'failed');
    assert.ok(failed); assert.equal(failed.attempts, 8); assert.equal((await json('/api/webhooks'))[0].failed, 1);
    await json(`/api/webhooks/${hook.id}/deliveries/${failed.id}/retry`, 'POST', {});
    // Simulate a process interruption after dispatch and before acknowledgement.
    runtime.db.prepare("UPDATE webhook_deliveries SET status='inflight' WHERE id=?").run(failed.id);
    await runtime.webhooks.stop(); await new Promise(r => server.close(r)); runtime.db.close();
    runtime = createApp({ dataDir: dir, webhookOptions: { now: () => clock, timeoutMs: 50 } });
    runtime.webhooks.recover(); server = runtime.app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r)); base = `http://127.0.0.1:${server.address().port}`;
    responseStatus = 204; await runtime.webhooks.tick();
    assert.equal((await json(`/api/webhooks/${hook.id}/deliveries`)).items.find(i => i.id === failed.id).status, 'delivered');
  });
  await t.test('unreachable endpoints fail honestly and tokens cannot manage subscriptions', async () => {
    const unreachable = await json('/api/webhooks', 'POST', { name: '不可达', url: 'http://127.0.0.1:1/events' });
    await json('/api/items', 'POST', { title: '不可达事件' }); await runtime.webhooks.tick();
    const result = (await json(`/api/webhooks/${unreachable.id}/deliveries`)).items[0]; assert.equal(result.status, 'pending'); assert.match(result.last_error, /无法连接/);
    const token = await json('/api/tokens', 'POST', { name: '普通插件', scope: 'write' });
    const denied = await fetch(base + '/api/webhooks', { headers: { Authorization: 'Bearer ' + token.token } }); assert.equal(denied.status, 403);
    assert.equal((await request('/api/webhooks', 'POST', { name: 'bad', url: 'file:///etc/passwd' })).status, 400);
    await request('/api/webhooks/' + unreachable.id, 'DELETE'); assert.ok(!(await json('/api/webhooks')).some(i => i.id === unreachable.id));
  });
  await t.test('full backup restores subscriptions, secrets, delivery history and recovers uncertain dispatches', async () => {
    const savedDelivery = runtime.db.prepare('SELECT id FROM webhook_deliveries WHERE webhook_id=? LIMIT 1').get(hook.id);
    runtime.db.prepare("UPDATE webhook_deliveries SET status='inflight' WHERE id=?").run(savedDelivery.id);
    const backup = await runtime.backups.run(); const preview = await runtime.backups.preview(runtime.backups.file(backup.id));
    await request('/api/webhooks/' + hook.id, 'DELETE'); assert.equal((await json('/api/webhooks')).length, 0);
    await runtime.backups.restore(preview.id);
    const signedIn = await request('/api/auth/login', 'POST', { password: '0048' }); cookie = signedIn.headers.get('set-cookie').split(';')[0];
    const hooks = await json('/api/webhooks'); assert.equal(hooks[0].id, hook.id);
    assert.equal(runtime.db.prepare('SELECT secret FROM webhooks WHERE id=?').get(hook.id).secret, hook.secret);
    assert.equal(runtime.db.prepare('SELECT status FROM webhook_deliveries WHERE id=?').get(savedDelivery.id).status, 'pending');
    await runtime.webhooks.tick();
    assert.equal(runtime.db.prepare('SELECT status FROM webhook_deliveries WHERE id=?').get(savedDelivery.id).status, 'delivered');
  });
});
