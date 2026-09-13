import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { createApp } from '../server/app.js';
import { localMediaReferences } from '../shared/local-media.js';

test('durable undo preserves versions, related notes, original bytes and conflict atomicity', async t => {
  const dir = await mkdtemp(resolve('artifacts/undo-api-'));
  let runtime, server, base, cookie;
  async function start() { runtime = createApp({ dataDir: dir }); server = runtime.app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r)); base = 'http://127.0.0.1:' + server.address().port; }
  async function stop() { await runtime.trash.stop(); await runtime.imports.stop(); await runtime.backups.stop(); await runtime.webhooks.stop(); await new Promise(r => server.close(r)); runtime.db.close(); }
  await start(); t.after(stop);
  const request = (path, method = 'GET', body, auth = cookie) => fetch(base + path, { method, headers: { ...(auth ? { Cookie: auth } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const json = async (path, method = 'GET', body) => { const r = await request(path, method, body); assert.ok(r.ok, `${r.status} ${await r.clone().text()}`); return r.json(); };
  const setup = await request('/api/auth/setup', 'POST', { password: '0915' }); cookie = setup.headers.get('set-cookie').split(';')[0];
  const a = await json('/api/collections', 'POST', { name: '原知识库' }), b = await json('/api/collections', 'POST', { name: '目标知识库' });
  const png = await sharp({ create: { width: 32, height: 24, channels: 3, background: '#597ab3' } }).png().toBuffer();
  const upload = async (index, group = 'undo:book') => {
    const form = new FormData(); form.append('file', new Blob([png], { type: 'image/png' }), 'page.png'); form.append('collection_id', a.id); form.append('group_key', group); form.append('group_index', String(index)); form.append('group_title', '撤销测试画册');
    const r = await fetch(base + '/api/assets', { method: 'POST', headers: { Cookie: cookie }, body: form }); assert.ok(r.ok, await r.clone().text()); return r.json();
  };
  let image = await upload(0), image2 = await upload(1);
  const note = await json('/api/items', 'POST', { title: '含配图的笔记', collection_id: a.id, content: `# 正文\n\n![第一张](${image.url})\n\n![第二张](${image2.url})` });
  const get = id => json('/api/items/' + id);
  [image, image2] = await Promise.all(localMediaReferences(note.content).map(ref => get(ref.id)));
  const versions = rows => rows.map(({ id, version }) => ({ id, version }));
  await t.test('delete and undo restore original note links, remove only generated aliases and preserve bytes', async () => {
    const beforeNote = await get(note.id), before = await get(image.id);
    const deleted = await json('/api/items/batch-trash', 'POST', { items: versions([before]), collection_id: a.id, undo: true });
    assert.ok(deleted.undo); assert.equal(deleted.undo.count, 3);
    const changedNote = await get(note.id), aliasId = localMediaReferences(changedNote.content)[0].id;
    assert.notEqual(aliasId, image.id); assert.equal((await get(aliasId)).deleted_at, null);
    assert.ok(Buffer.from(await (await request('/media/' + aliasId + '/original')).arrayBuffer()).equals(png));
    await json('/api/undo/' + deleted.undo.id, 'POST', {});
    assert.equal((await get(note.id)).content, beforeNote.content); assert.equal((await get(image.id)).deleted_at, null);
    assert.equal((await request('/api/items/' + aliasId)).status, 404);
    const afterVersion = (await get(image.id)).version;
    assert.ok(afterVersion > before.version);
    assert.equal((await json('/api/undo/' + deleted.undo.id, 'POST', {})).already_undone, true);
    assert.equal((await get(image.id)).version, afterVersion);
    await runtime.trash.cleanup();
    assert.ok(Buffer.from(await (await request('/media/' + image.id + '/original')).arrayBuffer()).equals(png));
  });
  await t.test('group move captures the implicitly moved note and all pages, surviving restart', async () => {
    const pages = await Promise.all([get(image.id), get(image2.id)]);
    const moved = await json('/api/items/batch-organize', 'POST', { items: versions(pages), collection_id: b.id, undo: true });
    assert.equal(moved.undo.count, 3); assert.equal((await get(note.id)).collection_id, b.id);
    await stop(); await start();
    assert.ok((await json('/api/undo')).actions.some(action => action.id === moved.undo.id));
    await json('/api/undo/' + moved.undo.id, 'POST', {});
    for (const id of [image.id, image2.id, note.id]) assert.equal((await get(id)).collection_id, a.id);
  });
  await t.test('same-field conflicts are atomic; unrelated edits survive undo; consecutive undos compose', async () => {
    const first = await json('/api/items/batch-tags', 'POST', { items: versions(await Promise.all([get(image.id), get(image2.id)])), tags: ['作者'], mode: 'add', undo: true });
    const second = await json('/api/items/batch-tags', 'POST', { items: versions(await Promise.all([get(image.id), get(image2.id)])), tags: ['参考'], mode: 'add', undo: true });
    assert.equal((await request('/api/undo/' + first.undo.id, 'POST', {})).status, 409);
    assert.deepEqual((await get(image2.id)).tags, ['作者', '参考']);
    const current = await get(image.id);
    await json('/api/items/' + image.id, 'PATCH', { version: current.version, title: '保留后续标题' });
    await json('/api/undo/' + second.undo.id, 'POST', {}); await json('/api/undo/' + first.undo.id, 'POST', {});
    assert.equal((await get(image.id)).title, '保留后续标题'); assert.deepEqual((await get(image.id)).tags, []);
    assert.deepEqual((await get(image2.id)).tags, []);
  });
  await t.test('undo refuses a conflicting note edit without partly restoring trashed media', async () => {
    const deleted = await json('/api/items/batch-trash', 'POST', { items: versions([await get(image.id)]), collection_id: a.id, undo: true });
    const current = await get(note.id);
    await json('/api/items/' + note.id, 'PATCH', { version: current.version, content: current.content + '\n\n后续正文' });
    assert.equal((await request('/api/undo/' + deleted.undo.id, 'POST', {})).status, 409);
    assert.ok((await get(image.id)).deleted_at); assert.ok((await get(note.id)).content.endsWith('后续正文'));
    await json('/api/items/' + image.id + '/restore', 'POST', {});
  });
  await t.test('expired receipts, different sessions and permanently deleted content cannot be undone', async () => {
    const row = await upload(0, 'undo:expiry');
    const edited = await json('/api/items/batch-tags', 'POST', { items: versions([row]), tags: ['临时'], undo: true });
    const login = await request('/api/auth/login', 'POST', { password: '0915' }), other = login.headers.get('set-cookie').split(';')[0];
    assert.equal((await request('/api/undo/' + edited.undo.id, 'POST', {}, other)).status, 410);
    runtime.db.prepare('UPDATE undo_actions SET expires_at=? WHERE id=?').run('2000-01-01T00:00:00Z', edited.undo.id);
    assert.equal((await request('/api/undo/' + edited.undo.id, 'POST', {})).status, 410);
    const deleted = await json('/api/items/batch-trash', 'POST', { items: versions([await get(row.id)]), collection_id: a.id, undo: true });
    const preview = await json('/api/trash/preview', 'POST', { collection_id: a.id, ids: [row.id] });
    await json('/api/trash/purge', 'POST', { collection_id: a.id, ids: [row.id], revision: preview.revision, confirm: 'DELETE' });
    assert.equal((await request('/api/undo/' + deleted.undo.id, 'POST', {})).status, 409);
  });
  await t.test('retention is bounded and no-op operations do not generate undo history', async () => {
    const row = await upload(0, 'undo:retention');
    for (let i = 0; i < 55; i++) await json('/api/items/batch-tags', 'POST', { items: versions([await get(row.id)]), tags: ['标签' + i], mode: 'replace', undo: true });
    assert.equal((await json('/api/undo')).actions.length, 50);
    const noop = await json('/api/items/batch-tags', 'POST', { items: versions([await get(row.id)]), tags: ['标签54'], mode: 'replace', undo: true }); assert.equal(noop.undo, null);
    const raw = await json('/api/items/batch-tags', 'POST', { items: versions([await get(row.id)]), tags: ['无撤销'], mode: 'replace' }); assert.equal(raw.undo, null);
    assert.equal(runtime.db.prepare('PRAGMA quick_check').get().quick_check, 'ok');
  });
  await t.test('10,000-item edits and undo record only changed fields, with bounded compressed history', async () => {
    const rows = [], date = new Date().toISOString();
    const insert = runtime.db.prepare("INSERT INTO items(id,kind,title,collection_id,created_at,updated_at) VALUES(?,'note','批量测试',?,?,?)");
    runtime.db.exec('BEGIN');
    for (let i = 0; i < 10000; i++) { const id = randomUUID(); insert.run(id, b.id, date, date); rows.push({ id, version: 1 }); }
    runtime.db.exec('COMMIT');
    const changed = await json('/api/items/batch-tags', 'POST', { items: rows, tags: ['批量'], undo: true });
    assert.equal(changed.undo.count, 10000);
    assert.ok(runtime.db.prepare('SELECT length(payload) bytes FROM undo_actions WHERE id=?').get(changed.undo.id).bytes < 1024 * 1024);
    await json('/api/undo/' + changed.undo.id, 'POST', {});
    assert.equal(runtime.db.prepare("SELECT count(*) n FROM items WHERE collection_id=? AND tags!='[]'").get(b.id).n, 0);
  });
  await t.test('full backup restores current-schema content but invalidates pre-restore undo receipts', async () => {
    const exported = await request('/api/export?mode=backup'), file = resolve(dir, 'full-backup.zip');
    assert.ok(exported.ok); await writeFile(file, Buffer.from(await exported.arrayBuffer()));
    const preview = await runtime.backups.preview(file); await runtime.backups.restore(preview.id);
    assert.equal(runtime.db.prepare('PRAGMA user_version').get().user_version, 13);
    assert.equal(runtime.db.prepare('SELECT count(*) n FROM undo_actions').get().n, 0);
    assert.equal(runtime.db.prepare('SELECT count(*) n FROM items WHERE collection_id=?').get(b.id).n, 10000);
    assert.equal((await request('/api/undo')).status, 401);
  });
});
