import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, copyFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { backup } from 'node:sqlite';
import { createApp } from '../server/app.js';
import { openDatabase } from '../server/db.js';
const config = { view: 'images', query: '建筑', tags: ['插画', '参考'], mode: 'all', sort: 'title', layout: 'grid' };

test('saved views are scoped, validated, conflict-aware, durable and included in complete restoration', async t => {
  const dir = await mkdtemp(resolve('artifacts/saved-views-'));
  let runtime, server, base, cookie;
  async function start() { runtime = createApp({ dataDir: dir }); server = runtime.app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r)); base = 'http://127.0.0.1:' + server.address().port; }
  async function stop() { await runtime.trash.stop(); await runtime.imports.stop(); await runtime.backups.stop(); await runtime.webhooks.stop(); await new Promise(r => server.close(r)); runtime.db.close(); }
  await start(); t.after(stop);
  const request = (path, method = 'GET', data, headers) => fetch(base + path, { method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(data ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: data ? JSON.stringify(data) : undefined });
  const json = async (path, method = 'GET', data, headers) => { const r = await request(path, method, data, headers); assert.ok(r.ok, await r.clone().text()); return r.json(); };
  assert.equal((await request('/api/saved-views')).status, 401);
  const setup = await request('/api/auth/setup', 'POST', { password: '0917' }); cookie = setup.headers.get('set-cookie').split(';')[0];
  const a = await json('/api/collections', 'POST', { name: '资料 A' }), b = await json('/api/collections', 'POST', { name: '资料 B' });
  const item = await json('/api/items', 'POST', { title: '必须保留的笔记', content: '正文', collection_id: a.id });
  const before = runtime.db.prepare('SELECT * FROM items ORDER BY id').all();
  let view = await json('/api/saved-views', 'POST', { name: '  建筑参考  ', collection_id: a.id, config: { ...config, tags: ['插画', '参考', '插画'] } });
  assert.equal(view.name, '建筑参考'); assert.deepEqual(view.config.tags, ['参考', '插画']);
  const other = await json('/api/saved-views', 'POST', { name: '建筑参考', collection_id: b.id, config });
  const unfiled = await json('/api/saved-views', 'POST', { name: '建筑参考', config });
  const list = library => json('/api/saved-views' + (library ? '?collection=' + library : ''));
  assert.deepEqual((await list(a.id)).views.map(v => v.id), [view.id]); assert.deepEqual((await list(b.id)).views.map(v => v.id), [other.id]); assert.deepEqual((await list()).views.map(v => v.id), [unfiled.id]);
  assert.equal((await request('/api/saved-views', 'POST', { name: '建筑参考', config })).status, 409);
  assert.equal((await request('/api/saved-views', 'POST', { name: '建筑参考', collection_id: a.id, config })).status, 409);
  for (const invalid of [{ ...config, view: 'home' }, { ...config, tags: Array(31).fill('x') }, { ...config, query: 'x'.repeat(201) }, { ...config, collection_id: b.id }, { ...config, sort: 'DROP TABLE' }]) assert.equal((await request('/api/saved-views', 'POST', { name: '无效', config: invalid })).status, 400);
  assert.equal((await request('/api/saved-views?collection=invalid')).status, 400);
  const read = await json('/api/tokens', 'POST', { name: 'read', scope: 'read' }), write = await json('/api/tokens', 'POST', { name: 'write', scope: 'write' });
  const readonly = { Authorization: 'Bearer ' + read.token };
  assert.equal((await request('/api/saved-views/' + view.id, 'GET', null, readonly)).status, 200);
  assert.equal((await request('/api/saved-views', 'POST', { name: '只读写入', config }, readonly)).status, 403);
  assert.equal((await request('/api/saved-views/' + view.id, 'PATCH', { name: '只读修改', version: 1 }, readonly)).status, 403);
  assert.equal((await request('/api/saved-views/' + view.id, 'DELETE', { version: 1 }, readonly)).status, 403);
  view = await json('/api/saved-views/' + view.id, 'PATCH', { version: 1, config: { ...config, mode: 'any', view: 'favorites' } }, { Authorization: 'Bearer ' + write.token });
  assert.equal(view.version, 2); assert.equal(view.collection_id, a.id); assert.equal(view.config.mode, 'any');
  assert.equal((await request('/api/saved-views/' + view.id, 'PATCH', { version: 1, name: '过期修改' })).status, 409);
  assert.equal((await request('/api/saved-views/' + view.id, 'DELETE', { version: 1 })).status, 409);
  assert.equal((await request('/api/saved-views/' + view.id, 'PATCH', { version: 2, collection_id: b.id })).status, 400);
  assert.equal((await json('/api/saved-views/' + view.id, 'PATCH', { version: 2, name: view.name })).version, 2);
  const racing = await Promise.all(['窗口 A', '窗口 B'].map(name => request('/api/saved-views/' + view.id, 'PATCH', { version: 2, name })));
  assert.deepEqual(racing.map(r => r.status).sort(), [200, 409]);
  view = await json('/api/saved-views/' + view.id);
  assert.equal(view.version, 3);
  for (let i = 0; i < 49; i++) await json('/api/saved-views', 'POST', { name: '常用 ' + i, collection_id: a.id, config });
  assert.equal((await request('/api/saved-views', 'POST', { name: '超额', collection_id: a.id, config })).status, 409);
  assert.equal((await list(a.id)).views.length, 50);
  const snapshots = runtime.db.prepare('SELECT * FROM saved_views ORDER BY id').all();
  await stop(); await start(); assert.deepEqual(runtime.db.prepare('SELECT * FROM saved_views ORDER BY id').all(), snapshots);
  const archive = await request('/api/export?mode=backup'), path = join(dir, 'complete.zip'); await writeFile(path, Buffer.from(await archive.arrayBuffer()));
  const restored = createApp({ dataDir: join(dir, 'restore') });
  try { const p = await restored.backups.preview(path); await restored.backups.restore(p.id); assert.deepEqual(restored.db.prepare('SELECT * FROM saved_views ORDER BY id').all(), snapshots); }
  finally { await restored.trash.stop(); await restored.imports.stop(); await restored.backups.stop(); await restored.webhooks.stop(); restored.db.close(); }
  assert.equal((await request('/api/saved-views/' + view.id, 'DELETE', { version: view.version })).status, 204);
  assert.deepEqual(runtime.db.prepare('SELECT * FROM items ORDER BY id').all(), before, 'deleting definitions never edits library content');
  assert.equal((await request('/api/collections/' + a.id, 'DELETE')).status, 204);
  assert.equal(runtime.db.prepare('SELECT count(*) n FROM saved_views WHERE collection_id=?').get(a.id).n, 0);
  assert.equal((await list()).views.length, 1); assert.equal((await list(b.id)).views.length, 1);
  assert.equal(runtime.db.prepare('SELECT collection_id FROM items WHERE id=?').get(item.id).collection_id, null);
  runtime.db.exec('DROP TABLE group_operations; DROP TABLE saved_views; PRAGMA user_version=9');
  const legacyPath = join(dir, 'schema9.zip'); await writeFile(legacyPath, Buffer.from(await (await request('/api/export?mode=backup')).arrayBuffer()));
  const legacyTarget = createApp({ dataDir: join(dir, 'legacy-restore') });
  try {
    let preview = await legacyTarget.backups.preview(path); await legacyTarget.backups.restore(preview.id);
    assert.ok(legacyTarget.db.prepare('SELECT count(*) n FROM saved_views').get().n > 0);
    preview = await legacyTarget.backups.preview(legacyPath); await legacyTarget.backups.restore(preview.id);
    assert.equal(legacyTarget.db.prepare('SELECT count(*) n FROM saved_views').get().n, 0);
    assert.equal(legacyTarget.db.prepare('SELECT title FROM items WHERE id=?').get(item.id).title, item.title);
  } finally { await legacyTarget.trash.stop(); await legacyTarget.imports.stop(); await legacyTarget.backups.stop(); await legacyTarget.webhooks.stop(); legacyTarget.db.close(); }
});

test('schema 9 upgrades additively and repeated startup preserves existing rows', async () => {
  const dir = await mkdtemp(resolve('artifacts/views-migration-'));
  let db = openDatabase(dir);
  db.exec("INSERT INTO collections VALUES('old-library','旧知识库','#123456','2026-01-01'); INSERT INTO items(id,kind,title,content,collection_id,created_at,updated_at) VALUES('old-note','note','旧正文','保留','old-library','2026-01-01','2026-01-01')");
  db.exec('DROP TABLE group_operations; DROP TABLE saved_views; PRAGMA user_version=9');
  const before = db.prepare('SELECT * FROM items').all();
  await backup(db, join(dir, 'before.sqlite')); db.close();
  await copyFile(join(dir, 'before.sqlite'), join(dir, 'znote.sqlite'));
  db = openDatabase(dir);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 11); assert.deepEqual(db.prepare('SELECT * FROM items').all(), before); assert.equal(db.prepare('SELECT count(*) n FROM saved_views').get().n, 0);
  db.close(); const next = openDatabase(dir); assert.deepEqual(next.prepare('SELECT * FROM items').all(), before); next.close();
});
