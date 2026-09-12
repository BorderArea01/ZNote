import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, stat, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createWriteStream } from 'node:fs';
import { finished } from 'node:stream/promises';
import archiver from 'archiver';
import sharp from 'sharp';
import { createApp } from '../server/app.js';

test('backup schedule, retention, validated preview, complete restore, rollback and restart', async t => {
  const dir = await mkdtemp(resolve('artifacts/backups-api-'));
  let clock = Date.now();
  let runtime = createApp({ dataDir: dir, backupOptions: { now: () => clock } });
  let server = runtime.app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  let base = `http://127.0.0.1:${server.address().port}`, cookie;
  const request = (path, method = 'GET', data) => fetch(base + path, { method, headers: { Cookie: cookie || '', ...(data ? { 'content-type': 'application/json' } : {}) }, body: data ? JSON.stringify(data) : undefined });
  const json = async (path, method, data) => { const r = await request(path, method, data); assert.ok(r.ok, await r.clone().text()); return r.json(); };
  const login = async () => { const r = await request('/api/auth/login', 'POST', { password: '0097' }); assert.equal(r.status, 200); cookie = r.headers.get('set-cookie').split(';')[0]; };
  const uploadPreview = async (buffer) => { const form = new FormData(); form.set('file', new Blob([buffer]), 'backup.zip'); return fetch(base + '/api/backups/preview', { method: 'POST', headers: { Cookie: cookie }, body: form }); };
  const setup = await request('/api/auth/setup', 'POST', { password: '0097' }); cookie = setup.headers.get('set-cookie').split(';')[0];
  t.after(async () => { await runtime.backups.stop(); await new Promise(r => server.close(r)); runtime.db.close(); });
  const collection = await json('/api/collections', 'POST', { name: '备份测试资料' });
  const original = await sharp({ create: { width: 400, height: 300, channels: 3, background: '#759177' } }).png().toBuffer();
  const form = new FormData(); form.set('file', new Blob([original]), '原图.png'); form.set('collection_id', collection.id);
  const image = await (await fetch(base + '/api/assets', { method: 'POST', headers: { Cookie: cookie }, body: form })).json();
  const note = await json('/api/items', 'POST', { title: '备份中的标题', collection_id: collection.id, content: `![原图](${image.url})`, tags: ['标签一', '标签二'] });
  let snapshot;
  await t.test('automatic tick persists success, honors interval and keeps multiple versions', async () => {
    await json('/api/backups/policy', 'PATCH', { enabled: true, interval_hours: 1, keep: 2 });
    await runtime.backups.tick();
    let status = await json('/api/backups'); assert.equal(status.backups.length, 1); assert.equal(status.last_success, clock);
    await runtime.backups.tick(); assert.equal((await json('/api/backups')).backups.length, 1);
    snapshot = Buffer.from(await (await request(`/api/backups/${status.backups[0].id}/download`)).arrayBuffer());
    clock += 3600001; await runtime.backups.tick(); clock += 3600001; await runtime.backups.tick();
    status = await json('/api/backups'); assert.equal(status.backups.length, 2); assert.equal(status.last_error, null);
    assert.ok(status.backups.every(b => b.bytes > 0));
  });
  await t.test('preview checks original hashes and does not change existing content', async () => {
    const response = await uploadPreview(snapshot); assert.equal(response.status, 200);
    const preview = await response.json(); assert.equal(preview.counts.items, 2); assert.equal(preview.unique_images, 1); assert.deepEqual(preview.collections, ['备份测试资料']);
    assert.equal((await json('/api/items/' + note.id)).title, note.title);
    assert.equal((await uploadPreview(Buffer.from('not a zip'))).status, 400);
    assert.equal((await readdir(join(dir, 'uploads'))).length, 0);
    await request('/api/backups/preview/' + preview.id, 'DELETE');
    assert.equal((await request('/api/backups/restore/' + preview.id, 'POST', { confirm: 'RESTORE' })).status, 404);
  });
  await t.test('restore rejects invalid confirmation; success resets data, preserves originals and saves previous state', async () => {
    const preview = await (await uploadPreview(snapshot)).json();
    await json('/api/items/' + note.id, 'PATCH', { version: note.version, title: '恢复前的新标题' });
    await json('/api/items', 'POST', { title: '恢复前才新增的笔记' });
    assert.equal((await request('/api/backups/restore/' + preview.id, 'POST', {})).status, 400);
    const restored = await json('/api/backups/restore/' + preview.id, 'POST', { confirm: 'RESTORE' });
    assert.equal(restored.restored, true); assert.ok((await stat(runtime.backups.file(restored.safety_backup))).size > 0);
    assert.equal((await request('/api/items')).status, 401);
    await login();
    assert.equal((await json('/api/items')).total, 2);
    assert.equal((await json('/api/items/' + note.id)).title, note.title);
    assert.deepEqual(Buffer.from(await (await request(image.url)).arrayBuffer()), original);
    const before = await (await uploadPreview(await readFile(runtime.backups.file(restored.safety_backup)))).json();
    assert.equal(before.counts.items, 3);
    await request('/api/backups/preview/' + before.id, 'DELETE');
    assert.equal((await readdir(join(dir, 'media'))).length, 1);
  });
  await t.test('transaction failure rolls back previous content and index, removes newly copied originals', async () => {
    const current = await json('/api/items/' + note.id);
    await json('/api/items/' + note.id, 'PATCH', { version: current.version, title: '必须保留的当前内容' });
    const preview = await (await uploadPreview(snapshot)).json();
    runtime.db.exec("CREATE TRIGGER test_restore_failure BEFORE INSERT ON items WHEN new.title='备份中的标题' BEGIN SELECT RAISE(ABORT,'injected restore failure'); END");
    const r = await request('/api/backups/restore/' + preview.id, 'POST', { confirm: 'RESTORE' }); assert.equal(r.status, 500);
    runtime.db.exec('DROP TRIGGER test_restore_failure');
    assert.equal((await json('/api/items/' + note.id)).title, '必须保留的当前内容');
    assert.equal((await json('/api/items?q=' + encodeURIComponent('必须保留'))).total, 1);
    assert.equal((await readdir(join(dir, 'media'))).length, 1);
    assert.deepEqual(Buffer.from(await (await request(image.url)).arrayBuffer()), original);
    await request('/api/backups/preview/' + preview.id, 'DELETE');
  });
  await t.test('corrupted original inside otherwise valid archive is rejected before restoration', async () => {
    const preview = await (await uploadPreview(snapshot)).json();
    const stage = (await readdir(join(dir, 'restore-staging'))).find(name => name.startsWith('preview-'));
    const sourceDir = join(dir, 'restore-staging', stage, 'data');
    const imageKey = (await readdir(join(sourceDir, 'media')))[0];
    await writeFile(join(sourceDir, 'media', imageKey), 'corrupted');
    const rejected = await request('/api/backups/restore/' + preview.id, 'POST', { confirm: 'RESTORE' }); assert.equal(rejected.status, 400);
    assert.equal((await json('/api/items/' + note.id)).title, '必须保留的当前内容');
    await request('/api/backups/preview/' + preview.id, 'DELETE');
  });
  await t.test('backups and schedule persist across restart, no immediate duplicate scheduled snapshot', async () => {
    await runtime.backups.stop(); await new Promise(r => server.close(r)); runtime.db.close();
    runtime = createApp({ dataDir: dir, backupOptions: { now: () => clock } });
    server = runtime.app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r)); base = `http://127.0.0.1:${server.address().port}`;
    const before = await json('/api/backups'); await runtime.backups.tick();
    const after = await json('/api/backups'); assert.equal(after.backups.length, before.backups.length); assert.equal(after.keep, 2); assert.equal(after.interval_hours, 1);
    assert.equal((await json('/api/items/' + note.id)).title, '必须保留的当前内容');
  });
  await t.test('read and write API tokens cannot read backups, preview or restore', async () => {
    const token = await json('/api/tokens', 'POST', { name: 'ordinary-plugin', scope: 'write' });
    for (const [path, method] of [['/api/backups', 'GET'], ['/api/backups', 'POST'], ['/api/backups/preview', 'POST'], ['/api/backups/restore/anything', 'POST']]) {
      const r = await fetch(base + path, { method, headers: { Authorization: 'Bearer ' + token.token } }); assert.equal(r.status, 403);
    }
  });
  await t.test('restore waits for active responses and blocks new writes until the replacement completes', async () => {
    const preview = await (await uploadPreview(snapshot)).json();
    let release; const hold = new Promise(r => { release = r; });
    runtime.app.get('/test-held-response', async (req, res) => { res.write('held'); await hold; res.end('released'); });
    const response = await fetch(base + '/test-held-response'); const consumed = response.text();
    const restoring = request('/api/backups/restore/' + preview.id, 'POST', { confirm: 'RESTORE' });
    const deadline = Date.now() + 1000;
    while (!runtime.maintenance.locked && Date.now() < deadline) await new Promise(r => setTimeout(r, 5));
    try {
      assert.equal(runtime.maintenance.locked, true);
      assert.equal((await request('/api/items', 'POST', { title: '恢复期间禁止写入' })).status, 503);
      assert.equal((await request('/api/health')).status, 200);
    } finally { release(); }
    assert.equal(await consumed, 'heldreleased'); assert.equal((await restoring).status, 200);
    await login(); assert.equal((await json('/api/items')).total, 2);
  });
  await t.test('failed scheduled backup preserves prior versions, exposes failure and can recover', async () => {
    const row = runtime.db.prepare('SELECT * FROM items WHERE id=?').get(image.id), path = join(dir, 'media', row.file_key);
    const stored = await readFile(path); const before = (await json('/api/backups')).backups.map(b => b.id);
    clock += 3600001;
    await unlink(path);
    try { assert.equal((await request('/api/backups', 'POST', {})).status, 500); }
    finally { await writeFile(path, stored); }
    const status = await json('/api/backups'); assert.ok(status.last_error); assert.deepEqual(status.backups.map(b => b.id), before);
    assert.ok(!(await readdir(join(dir, 'backups'))).some(name => name.endsWith('.tmp')));
    clock += 600001; await runtime.backups.tick(); assert.equal((await json('/api/backups')).last_error, null);
  });
});
