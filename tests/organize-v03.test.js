import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { resolve, join, posix } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import sharp from 'sharp';
import { createApp } from '../server/app.js';
import { WorkQueue } from '../server/work-queue.js';
import { optimizeStorage } from '../server/storage.js';

function unzip(buffer) {
  let end = buffer.length - 22;
  while (buffer.readUInt32LE(end) !== 0x06054b50) end--;
  let cursor = buffer.readUInt32LE(end + 16);
  const files = new Map();
  for (let i = 0; i < buffer.readUInt16LE(end + 10); i++) {
    const method = buffer.readUInt16LE(cursor + 10), size = buffer.readUInt32LE(cursor + 20);
    const nameLength = buffer.readUInt16LE(cursor + 28), extra = buffer.readUInt16LE(cursor + 30), comment = buffer.readUInt16LE(cursor + 32);
    const local = buffer.readUInt32LE(cursor + 42);
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString();
    const offset = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    const raw = buffer.subarray(offset, offset + size);
    assert.ok(!files.has(name), 'archive paths must be unique');
    files.set(name, method === 8 ? inflateRawSync(raw) : raw);
    cursor += 46 + nameLength + extra + comment;
  }
  return files;
}

test('v0.3 shared originals, independent metadata, atomic organization and readable exports', async t => {
  const dir = await mkdtemp(resolve('artifacts/organize-api-'));
  let runtime = createApp({ dataDir: dir });
  let server = runtime.app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  let base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await new Promise(r => server.close(r)); runtime.db.close(); });
  const setup = await fetch(base + '/api/auth/setup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: '0031' }) });
  const cookie = setup.headers.get('set-cookie').split(';')[0];
  const request = (path, method = 'GET', data) => fetch(base + path, { method, headers: { Cookie: cookie, ...(data ? { 'content-type': 'application/json' } : {}) }, body: data ? JSON.stringify(data) : undefined });
  const json = async (path, method, data) => { const r = await request(path, method, data); assert.ok(r.ok, await r.clone().text()); return r.json(); };
  const a = await json('/api/collections', 'POST', { name: '工作/设计素材' });
  const b = await json('/api/collections', 'POST', { name: '灵感（参考）' });
  const c = await json('/api/collections', 'POST', { name: '整理结果' });
  const original = await sharp({ create: { width: 1200, height: 900, channels: 3, background: '#728891' } }).png({ compressionLevel: 0 }).toBuffer();
  const upload = async (collection, title = '中文 (原图).png') => {
    const form = new FormData(); form.set('file', new Blob([original]), title); form.set('collection_id', collection);
    form.set('source_url', 'https://example.org/reference');
    const r = await fetch(base + '/api/assets', { method: 'POST', headers: { Cookie: cookie }, body: form });
    assert.ok(r.ok, await r.clone().text()); return r.json();
  };
  let first, second;
  await t.test('concurrent cross-library uploads create independent entries and one original', async () => {
    const entries = await Promise.all([upload(a.id), upload(b.id), upload(a.id), upload(b.id)]);
    [first, second] = entries;
    assert.notEqual(first.id, second.id);
    assert.equal(first.id, entries[2].id); assert.equal(second.id, entries[3].id);
    const rows = runtime.db.prepare("SELECT * FROM items WHERE kind='image'").all();
    assert.equal(rows.length, 2); assert.equal(new Set(rows.map(r => r.file_key)).size, 1);
    assert.equal((await readdir(join(dir, 'media'))).length, 1);
    assert.equal((await readdir(join(dir, 'uploads'))).length, 0);
    assert.ok(first.captured_at); assert.equal(first.source_url, 'https://example.org/reference');
    second = await json(`/api/items/${second.id}`, 'PATCH', { version: second.version, title: '另一份标题', tags: ['独立标签'], content: '另一份说明' });
    const unchanged = await json(`/api/items/${first.id}`);
    assert.equal(unchanged.title, first.title); assert.deepEqual(unchanged.tags, ['example.org']);
    await request(`/api/items/${first.id}`, 'DELETE');
    assert.deepEqual(Buffer.from(await (await request(second.url)).arrayBuffer()), original);
    first = await json(`/api/items/${first.id}/restore`, 'POST', {});
    const copied = await json(`/api/items/${first.id}/copy`, 'POST', { collection_id: c.id, title: '复用图片' });
    assert.equal(copied.shared, true); assert.equal((await readdir(join(dir, 'media'))).length, 1);
    assert.equal((await json(`/api/items/${first.id}/copy`, 'POST', { collection_id: c.id })).id, copied.id);
    const stats = await json('/api/storage'); assert.equal(stats.images, 1); assert.equal(stats.image_entries, 3); assert.equal(stats.source_bytes, original.length);
  });
  await t.test('batch version conflict and duplicate-target conflict leave every item unchanged', async () => {
    const note = await json('/api/items', 'POST', { title: '待整理笔记', collection_id: a.id });
    const failed = await request('/api/items/batch-organize', 'POST', { items: [{ id: note.id, version: note.version }, { id: second.id, version: 999 }], favorite: true });
    assert.equal(failed.status, 409); assert.equal((await json(`/api/items/${note.id}`)).favorite, false);
    const collision = await request('/api/items/batch-organize', 'POST', { items: [{ id: note.id, version: note.version }, { id: second.id, version: second.version }], collection_id: a.id });
    assert.equal(collision.status, 409); assert.equal((await json(`/api/items/${note.id}`)).version, note.version);
    const result = await json('/api/items/batch-organize', 'POST', { items: [{ id: note.id, version: note.version }], collection_id: b.id, favorite: true });
    assert.equal(result.items[0].collection_id, b.id); assert.equal(result.items[0].favorite, true);
  });
  await t.test('readable ZIP retains originals, per-entry tags and relative cross-library note links', async () => {
    const note = await json('/api/items', 'POST', { title: '../参考: (笔记)', collection_id: b.id, tags: ['笔记标签'], content: `![参考](${first.url})` });
    for (const mode of ['portable', 'images', 'markdown', 'html']) {
      const r = await request(`/api/export?mode=${mode}&collection=${b.id}`);
      assert.equal(r.status, 200);
      const files = unzip(Buffer.from(await r.arrayBuffer()));
      const manifest = JSON.parse(files.get(mode === 'images' ? 'images.json' : 'manifest.json'));
      const entries = manifest.items || manifest.images;
      for (const [path] of files) assert.ok(!path.startsWith('/') && !path.split('/').includes('..') && !path.includes('\\'));
      const noteImageId=note.content.match(/\/media\/([^/]+)\//)[1]; const imageEntry = entries.find(i => i.id === (mode === 'markdown' ? noteImageId : second.id));
      assert.match(imageEntry.file, /图片/); assert.match(imageEntry.file, /中文|另一份标题/);
      assert.deepEqual(files.get(imageEntry.file), original);
      const sidecar = JSON.parse(files.get(imageEntry.file + '.json'));
      assert.deepEqual(sidecar.tags, imageEntry.tags); assert.equal(sidecar.content, imageEntry.content);
      if (mode === 'portable' || mode === 'markdown') {
        const exportedNote = entries.find(i => i.id === note.id);
        const markdown = files.get(exportedNote.file).toString();
        const link = markdown.match(/\]\(([^)]+)\)/)[1];
        const attachment = posix.normalize(posix.join(posix.dirname(exportedNote.file), decodeURIComponent(link.replace(/^<|>$/g,''))));
        assert.deepEqual(files.get(attachment), original);
      }
      if (mode === 'html') assert.match(files.get('index.html').toString(), /%E5|%E7/);
    }
    const backup = unzip(Buffer.from(await (await request('/api/export?mode=backup')).arrayBuffer()));
    assert.equal([...backup.keys()].filter(k => k.startsWith('data/media/')).length, 1);
  });
  await t.test('trigram search updates transactionally; Chinese short queries still work', async () => {
    let note = await json('/api/items', 'POST', { title: '索引验证文本', content: 'uniqueLongPhrase' });
    assert.equal((await json('/api/items?q=uniqueLongPhrase')).total, 1);
    assert.equal((await json('/api/items?q=' + encodeURIComponent('验证'))).total, 1);
    note = await json(`/api/items/${note.id}`, 'PATCH', { version: note.version, content: 'replacementTerm' });
    assert.equal((await json('/api/items?q=uniqueLongPhrase')).total, 0);
    assert.equal((await json('/api/items?q=replacementTerm')).total, 1);
    runtime.db.prepare("INSERT INTO items_search(items_search,rank) VALUES('integrity-check',1)").run();
  });
  await t.test('shared storage optimization and restart preserve each original reference', async () => {
    await new Promise(r => server.close(r));
    await optimizeStorage(runtime.db, dir); runtime.db.close();
    runtime = createApp({ dataDir: dir }); server = runtime.app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
    for (const item of [first, second]) assert.deepEqual(Buffer.from(await (await request(item.url)).arrayBuffer()), original);
    assert.equal((await readdir(join(dir, 'media'))).length, 1);
    assert.equal((await json(`/api/items/${second.id}`)).title, '另一份标题');
  });
});

test('thumbnail queue coalesces jobs, bounds concurrency, rejects overload and recovers after failure', async () => {
  const queue = new WorkQueue(2, 3);
  let started = 0; const releases = [];
  const work = key => queue.run(key, () => new Promise(r => { started++; releases.push(r); }));
  const a = work('a'), again = work('a'), b = work('b'), c = work('c'), d = work('d'), e = work('e');
  assert.equal(a, again);
  await assert.rejects(work('overflow'), /队列已满/);
  await new Promise(r => setImmediate(r)); assert.equal(started, 2); assert.equal(queue.peak, 2);
  while (queue.active || queue.pending.length) { releases.splice(0).forEach(r => r('ok')); await new Promise(r => setImmediate(r)); }
  await Promise.all([a, b, c, d, e]);
  await assert.rejects(queue.run('bad', () => { throw new Error('decode error'); }), /decode error/);
  await new Promise(r => setImmediate(r));
  assert.equal(await queue.run('bad', () => 'recovered'), 'recovered');
});
