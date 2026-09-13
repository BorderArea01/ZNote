import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import sharp from 'sharp';
import { createApp } from '../server/app.js';
import { openDatabase } from '../server/db.js';

test('image regrouping preserves source identity, note groups, covers, undo and complete restoration', async t => {
  const dir = await mkdtemp(resolve('artifacts/group-organize-')); let runtime, server, base, cookie;
  async function start() { runtime = createApp({ dataDir: dir }); server = runtime.app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r)); base = 'http://127.0.0.1:' + server.address().port; }
  async function stop() { await runtime.trash.stop(); await runtime.imports.stop(); await runtime.backups.stop(); await runtime.webhooks.stop(); await new Promise(r => server.close(r)); runtime.db.close(); }
  await start(); t.after(stop);
  const request = (path, method = 'GET', body, headers = {}) => fetch(base + path, { method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const json = async (...args) => { const r = await request(...args); assert.ok(r.ok, await r.clone().text()); return r.json(); };
  const setup = await request('/api/auth/setup', 'POST', { password: '0918' }); cookie = setup.headers.get('set-cookie').split(';')[0];
  const a = await json('/api/collections', 'POST', { name: '素材库' }), b = await json('/api/collections', 'POST', { name: '另一个库' });
  const pixels = await sharp({ create: { width: 24, height: 20, channels: 3, background: '#abcdee' } }).png().toBuffer();
  const upload = async (index, library = a.id, grouped = true) => {
    const bytes = grouped ? pixels : await sharp({ create: { width: 24, height: 20, channels: 3, background: '#ccbbaa' } }).png().toBuffer();
    const form = new FormData(); form.set('file', new Blob([bytes]), 'page.png'); form.set('collection_id', library); form.set('title', grouped ? '原页 ' + index : '独立素材');
    if (grouped) { form.set('group_key', 'pixiv:art:12345'); form.set('group_index', index); form.set('group_title', '来源漫画'); form.set('source_url', 'https://www.pixiv.net/artworks/12345'); }
    const r = await fetch(base + '/api/assets', { method: 'POST', headers: { Cookie: cookie }, body: form }); assert.ok(r.ok, await r.clone().text()); return r.json();
  };
  const pages = [await upload(0), await upload(1), await upload(2)], loose = await upload(0, a.id, false), foreign = await upload(0, b.id);
  const note = await json('/api/items', 'POST', { title: '保留的笔记', collection_id: a.id, content: `正文 [链接](https://example.com)\n\n![首图](${pages[0].url})\n\n![末图](${pages[2].url})` });
  const noteRows = (await json('/api/item-groups/order?id=' + note.id)).items;
  const originalNote = runtime.db.prepare('SELECT * FROM items WHERE id=?').get(note.id);
  const originalNotePages = runtime.db.prepare('SELECT * FROM items WHERE group_key=? ORDER BY id').all('note:' + note.id);
  const originals = (await readdir(join(dir, 'media'))).sort();
  const get = id => json('/api/items/' + id);
  const input = async (ids, extra = {}) => ({ items: await Promise.all(ids.map(async id => { const row = await get(id); return { id, version: row.version }; })), collection_id: a.id, mode: 'create', title: '手工立面研究', ...extra });
  const preview = value => json('/api/item-groups/organize/preview', 'POST', value);
  const commit = state => json('/api/item-groups/organize', 'POST', { ...state.input, revision: state.revision, operation_id: state.operation_id, prepared_at: state.prepared_at, undo: true });
  const groupIds = id => json('/api/item-groups/order?id=' + id).then(r => r.items.map(i => i.id));
  let plan = await preview(await input([pages[1].id, loose.id]));
  assert.equal(plan.changed_count, 2); assert.equal(plan.expanded_count, 2); assert.equal(plan.cover.id, pages[1].id);
  let result = await commit(plan); assert.ok(result.group_key.startsWith('manual:')); assert.equal(result.item.id, pages[1].id);
  assert.deepEqual(await groupIds(result.item.id), [pages[1].id, loose.id]);
  assert.equal((await upload(1)).id, pages[1].id); assert.equal((await get(pages[1].id)).group_key, result.group_key); assert.equal((await get(pages[1].id)).group_index, 1);
  assert.equal((await json('/api/items?collection=' + a.id + '&grouped=true&q=' + encodeURIComponent('手工立面研究'))).total, 1);
  const copied = await json('/api/items/' + loose.id + '/copy', 'POST', { collection_id: b.id }); assert.equal(copied.group_manual, 1);
  await json('/api/undo/' + result.undo.id, 'POST', {}); assert.equal((await get(pages[1].id)).group_key, 'pixiv:art:12345'); assert.equal((await get(loose.id)).group_key, null);
  result = await commit(await preview(await input([loose.id], { title: '追加目标' }))); const target = result.item.id;
  plan = await preview(await input([pages[2].id], { mode: 'append', target_id: target, whole_groups: true }));
  assert.equal(plan.expanded_count, 3); assert.equal(plan.result_count, 4); assert.equal(plan.cover.id, target);
  result = await commit(plan); assert.deepEqual(await groupIds(target), [target, ...pages.map(p => p.id)]);
  plan = await preview(await input(noteRows.map(p => p.id), { mode: 'append', target_id: target })); assert.equal(plan.copied_count, 2);
  const noteCopies = await commit(plan); assert.equal(noteCopies.copied_count, 2);
  assert.deepEqual(runtime.db.prepare('SELECT * FROM items WHERE id=?').get(note.id), originalNote);
  assert.deepEqual(runtime.db.prepare('SELECT * FROM items WHERE group_key=? ORDER BY id').all('note:' + note.id), originalNotePages);
  assert.deepEqual((await readdir(join(dir, 'media'))).sort(), originals);
  // A response can be lost after commit: replay the same operation without new aliases.
  const copyPlan = await preview(await input(noteRows.map(p => p.id), { title: '可安全重试的组' }));
  const copyResult = await commit(copyPlan), copyAgain = await commit(copyPlan);
  assert.equal(copyAgain.replayed, true); assert.deepEqual(copyAgain.ids, copyResult.ids); assert.equal(copyAgain.undo.id, copyResult.undo.id);
  assert.equal(runtime.db.prepare('SELECT count(*) n FROM items WHERE group_key=?').get(copyResult.group_key).n, 2);
  const copyBody = { ...copyPlan.input, revision: copyPlan.revision, operation_id: copyPlan.operation_id, prepared_at: copyPlan.prepared_at, undo: true };
  assert.equal((await request('/api/item-groups/organize', 'POST', { ...copyBody, title: '另一请求' })).status, 409);
  assert.equal((await request('/api/item-groups/organize', 'POST', { ...copyBody, operation_id: randomUUID(), prepared_at: '2020-01-01T00:00:00.000Z' })).status, 410);
  const writer = await json('/api/tokens', 'POST', { name: 'another caller', scope: 'write' });
  assert.equal((await request('/api/item-groups/organize', 'POST', copyBody, { Authorization: 'Bearer ' + writer.token })).status, 409);
  await json('/api/undo/' + copyResult.undo.id, 'POST', {});
  assert.equal((await commit(copyPlan)).already_undone, true);
  assert.equal(runtime.db.prepare('SELECT count(*) n FROM items WHERE group_key=?').get(copyResult.group_key).n, 0);
  const repeat = await preview(await input(noteRows.map(p => p.id), { mode: 'append', target_id: target })); assert.equal(repeat.changed_count, 0); assert.equal(repeat.existing_count, 2);
  assert.equal((await commit(repeat)).changed_count, 0);
  await json('/api/undo/' + noteCopies.undo.id, 'POST', {}); assert.equal((await groupIds(target)).length, 4); assert.deepEqual((await readdir(join(dir, 'media'))).sort(), originals);
  plan = await preview(await input([pages[1].id], { mode: 'detach' })); result = await commit(plan);
  let detached = await get(pages[1].id); assert.equal(detached.group_key, null); assert.equal(detached.group_index, 1); assert.equal(detached.group_manual, 1);
  assert.equal((await upload(1)).group_key, null, 'reimport never reconstructs a deliberately detached group');
  await json('/api/undo/' + result.undo.id, 'POST', {}); assert.equal((await get(pages[1].id)).group_key, (await get(target)).group_key);
  const skip = await preview(await input(noteRows.map(p => p.id), { note_mode: 'exclude' })); assert.equal(skip.excluded_count, 2); assert.equal(skip.changed_count, 0);
  const stable = runtime.db.prepare('SELECT * FROM items ORDER BY id').all();
  assert.equal((await request('/api/item-groups/organize/preview', 'POST', await input([foreign.id]))).status, 409);
  assert.equal((await request('/api/item-groups/organize/preview', 'POST', await input([note.id]))).status, 409);
  assert.deepEqual(runtime.db.prepare('SELECT * FROM items ORDER BY id').all(), stable);
  plan = await preview(await input([pages[0].id]));
  const changed = await get(pages[2].id); await json('/api/items/' + changed.id, 'PATCH', { version: changed.version, favorite: true });
  const beforeConflict = runtime.db.prepare('SELECT * FROM items ORDER BY id').all();
  assert.equal((await request('/api/item-groups/organize', 'POST', { ...plan.input, revision: plan.revision, operation_id: plan.operation_id, prepared_at: plan.prepared_at, undo: true })).status, 409);
  assert.deepEqual(runtime.db.prepare('SELECT * FROM items ORDER BY id').all(), beforeConflict);
  assert.equal(runtime.db.prepare('SELECT count(*) n FROM group_operations WHERE id=?').get(plan.operation_id).n, 0);
  // An unrelated later member is a real group conflict when undoing regrouping.
  const reformed = await commit(await preview(await input([pages[0].id], { title: '撤销保护组' })));
  await commit(await preview(await input([pages[1].id], { mode: 'append', target_id: pages[0].id })));
  const beforeUndo = runtime.db.prepare('SELECT * FROM items ORDER BY id').all();
  assert.equal((await request('/api/undo/' + reformed.undo.id, 'POST', {})).status, 409);
  assert.deepEqual(runtime.db.prepare('SELECT * FROM items ORDER BY id').all(), beforeUndo);
  const readToken = await json('/api/tokens', 'POST', { name: 'read', scope: 'read' });
  assert.equal((await request('/api/item-groups/organize', 'POST', {}, { Authorization: 'Bearer ' + readToken.token })).status, 403);
  const raw = await request('/media/' + pages[0].id + '/original'); assert.ok(Buffer.from(await raw.arrayBuffer()).equals(pixels));
  await stop(); await start(); assert.deepEqual(runtime.db.prepare('SELECT * FROM items ORDER BY id').all(), beforeUndo);
  assert.equal((await commit(copyPlan)).already_undone, true, 'receipt and undo state survive restart');
  const zip = join(dir, 'complete.zip'); await writeFile(zip, Buffer.from(await (await request('/api/export?mode=backup')).arrayBuffer()));
  const restored = createApp({ dataDir: join(dir, 'restored') });
  try { const p = await restored.backups.preview(zip); await restored.backups.restore(p.id); const normalize = rows => rows.map(({ file_key, thumbnail_key, ...r }) => r); assert.deepEqual(normalize(restored.db.prepare('SELECT * FROM items ORDER BY id').all()), normalize(beforeUndo)); assert.equal(restored.db.prepare('SELECT count(*) n FROM group_operations').get().n, 0);
    const restoredServer=restored.app.listen(0,'127.0.0.1'); await new Promise(r=>restoredServer.once('listening',r));
    try { const response=await fetch('http://127.0.0.1:'+restoredServer.address().port+'/api/item-groups/organize',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+writer.token},body:JSON.stringify(copyBody)}); assert.equal(response.status,410,'pre-restore operations cannot execute against a restored graph'); }
    finally { await new Promise(r=>restoredServer.close(r)); }
  }
  finally { await restored.trash.stop(); await restored.imports.stop(); await restored.backups.stop(); await restored.webhooks.stop(); restored.db.close(); }
  await request('/api/items/' + pages[0].id, 'DELETE');
  const recollectedNotePage = await upload(0);
  assert.equal(recollectedNotePage.group_key, 'note:' + note.id, 'collector cannot take a surviving note attachment out of its note group');
  assert.deepEqual(runtime.db.prepare('SELECT * FROM items WHERE id=?').get(note.id), originalNote);
});

test('regrouping 10000 pages has bounded preview output and upgrades schema 10 without rewriting data', async t => {
  const dir = await mkdtemp(resolve('artifacts/group-organize-large-')); let db = openDatabase(dir);
  db.exec('DROP TABLE reading_progress; DROP TABLE group_operations; DROP INDEX items_group_origin; ALTER TABLE items DROP COLUMN group_manual; ALTER TABLE items DROP COLUMN group_origin_id; PRAGMA user_version=10');
  db.prepare("INSERT INTO items(id,kind,title,content,created_at,updated_at) VALUES(?,'note','升级前的笔记','保持正文','2026-01-01','2026-01-01')").run(randomUUID());
  const before = db.prepare('SELECT * FROM items').all().map(row=>({...row})); db.close(); db = openDatabase(dir);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 13); assert.deepEqual(db.prepare('SELECT * FROM items').all().map(({group_manual,group_origin_id,...row}) => { assert.equal(group_manual,0); assert.equal(group_origin_id,null); return row; }), before); db.close();
  const runtime = createApp({ dataDir: dir }), server = runtime.app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  t.after(async () => { await runtime.trash.stop(); await runtime.imports.stop(); await runtime.backups.stop(); await runtime.webhooks.stop(); await new Promise(r => server.close(r)); runtime.db.close(); });
  const base = 'http://127.0.0.1:' + server.address().port, setup = await fetch(base + '/api/auth/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: '0918' }) }), cookie = setup.headers.get('set-cookie').split(';')[0];
  const rows = [], date = new Date().toISOString(), insert = runtime.db.prepare("INSERT INTO items(id,kind,title,group_key,group_index,created_at,updated_at) VALUES(?,'image','批量页','large:test',?,?,?)");
  runtime.db.exec('BEGIN'); for (let i = 0; i < 10000; i++) { const id = randomUUID(); insert.run(id, i, date, date); rows.push(id); } runtime.db.exec('COMMIT');
  const request = body => fetch(base + '/api/item-groups/organize' + (body.revision ? '' : '/preview'), { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const value = { items: [{ id: rows[0], version: 1 }], collection_id: null, mode: 'create', title: '长篇素材', whole_groups: true };
  const previewResponse = await request(value); assert.ok(previewResponse.ok); const text = await previewResponse.text(); assert.ok(text.length < 30000);
  const preview = JSON.parse(text); assert.equal(preview.expanded_count, 10000); assert.equal(preview.items.length, 60);
  const saved = await request({ ...preview.input, revision: preview.revision, operation_id: preview.operation_id, prepared_at: preview.prepared_at, undo: true }); assert.ok(saved.ok, await saved.clone().text()); const result = await saved.json(); assert.equal(result.changed_count, 10000);
  assert.equal(runtime.db.prepare('SELECT count(*) n FROM items WHERE group_key=? AND group_manual=1').get(result.group_key).n, 10000);
  const undone = await fetch(base + '/api/undo/' + result.undo.id, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: '{}' }); assert.ok(undone.ok, await undone.clone().text());
  assert.equal(runtime.db.prepare("SELECT count(*) n FROM items WHERE group_key='large:test' AND group_manual=0").get().n, 10000);
  insert.run(randomUUID(), 10000, date, date); const currentVersion = runtime.db.prepare('SELECT version FROM items WHERE id=?').get(rows[0]).version;
  assert.equal((await request({ ...value, items: [{ id: rows[0], version: currentVersion }] })).status, 413);
});
