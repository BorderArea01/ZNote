import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createApp } from '../server/app.js';

test('note history captures committed revisions, survives restore, bounds storage and follows permanent deletion', async t => {
  const dir = await mkdtemp(resolve('artifacts/note-history-'));
  let runtime, server, base, cookie;
  async function start() { runtime = createApp({ dataDir: dir }); server = runtime.app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r)); base = 'http://127.0.0.1:' + server.address().port; }
  async function stop() { await runtime.trash.stop(); await runtime.imports.stop(); await runtime.backups.stop(); await runtime.webhooks.stop(); await new Promise(r => server.close(r)); runtime.db.close(); }
  await start(); t.after(stop);
  const request = (path, method = 'GET', data) => fetch(base + path, { method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(data ? { 'Content-Type': 'application/json' } : {}) }, body: data ? JSON.stringify(data) : undefined });
  const json = async (path, method = 'GET', data) => { const r = await request(path, method, data); assert.ok(r.ok, await r.clone().text()); return r.json(); };
  const setup = await request('/api/auth/setup', 'POST', { password: '0916' }); cookie = setup.headers.get('set-cookie').split(';')[0];
  let note = await json('/api/items', 'POST', { title: '版本测试', content: '# 第一稿\n\n[链接](https://example.com/)', tags: ['原标签'] });
  const history = () => json('/api/items/' + note.id + '/versions');
  assert.equal((await history()).versions.length, 1);
  const first = (await history()).versions[0];
  note = await json('/api/items/' + note.id, 'PATCH', { version: note.version, favorite: true });
  assert.equal((await history()).versions.length, 1, 'favorite does not duplicate text snapshots');
  note = await json('/api/items/' + note.id, 'PATCH', { version: note.version, content: '第二稿', undo: true });
  assert.equal((await history()).versions.length, 2);
  await json('/api/undo/' + note.undo.id, 'POST', {});
  note = await json('/api/items/' + note.id);
  assert.ok(note.content.startsWith('# 第一稿')); assert.equal((await history()).versions.length, 3);
  const immutable = await json('/api/items/' + note.id + '/versions/' + first.id);
  assert.equal(immutable.content, '# 第一稿\n\n[链接](https://example.com/)'); assert.deepEqual(immutable.tags, ['原标签']);
  const beforeConflict = (await history()).versions.length;
  assert.equal((await request('/api/items/' + note.id, 'PATCH', { version: 1, content: '不应留下版本' })).status, 409);
  assert.equal((await history()).versions.length, beforeConflict);
  for (let i = 0; i < 55; i++) note = await json('/api/items/' + note.id, 'PATCH', { version: note.version, content: '草稿阶段 ' + i });
  assert.equal((await history()).versions.length, 50); assert.equal((await request('/api/items/' + note.id + '/versions/' + first.id)).status, 404);
  const snapshots = runtime.db.prepare('SELECT * FROM note_versions ORDER BY id').all();
  await stop(); await start(); assert.equal((await history()).versions.length, 50);
  const archive = await request('/api/export?mode=backup'), path = join(dir, 'complete.zip'); await writeFile(path, Buffer.from(await archive.arrayBuffer()));
  const restored = createApp({ dataDir: join(dir, 'restore') });
  try {
    const preview = await restored.backups.preview(path); await restored.backups.restore(preview.id);
    assert.deepEqual(restored.db.prepare('SELECT * FROM note_versions ORDER BY id').all(), snapshots);
  } finally { await restored.trash.stop(); await restored.imports.stop(); await restored.backups.stop(); await restored.webhooks.stop(); restored.db.close(); }
  await request('/api/items/' + note.id, 'DELETE');
  assert.equal((await history()).versions.length, 50);
  const preview = await json('/api/trash/preview', 'POST', { collection_id: null, ids: [note.id] });
  await json('/api/trash/purge', 'POST', { collection_id: null, ids: [note.id], revision: preview.revision, confirm: 'DELETE' });
  assert.equal(runtime.db.prepare('SELECT count(*) n FROM note_versions').get().n, 0);
  assert.equal((await history().catch(() => null)), null);
});
