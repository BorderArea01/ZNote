import sharp from 'sharp';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createApp } from '../server/app.js';
import { originalBuffer, digest } from '../server/storage.js';
import { openDatabase } from '../server/db.js';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import yauzl from 'yauzl';
function unzip(buffer) {
  return new Promise((resolve, reject) => yauzl.fromBuffer(buffer, { lazyEntries: true }, (error, zip) => {
    if (error) return reject(error); const entries = new Map(); zip.on('error', reject); zip.on('end', () => resolve(entries));
    zip.on('entry', entry => { if (entry.fileName.endsWith('/')) return zip.readEntry(); zip.openReadStream(entry, (error, stream) => { if (error) return reject(error); const chunks = []; stream.on('data', chunk => chunks.push(chunk)); stream.on('error', reject); stream.on('end', () => { entries.set(entry.fileName, Buffer.concat(chunks)); zip.readEntry(); }); }); }); zip.readEntry();
  }));
}

test('video upload, validation, ranges, dedupe, export, backup restore and restart', async () => {
  const dir = await mkdtemp(resolve('artifacts/video-api-')); let runtime = createApp({ dataDir: dir });
  let server = runtime.app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r)); let base = `http://127.0.0.1:${server.address().port}`;
  let cookie;
  const request = (path, options = {}) => fetch(base + path, { ...options, headers: { ...(cookie ? { Cookie: cookie } : {}), ...options.headers } });
  const post = (path, data) => request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  const file = await readFile('tests/fixtures/sample.mp4'), webm = await readFile('tests/fixtures/sample.webm');
  const upload = (bytes, library, name = '测试视频.mp4') => { const form = new FormData(); form.set('file', new Blob([bytes]), name); form.set('tags', '["视频","参考"]'); if (library) form.set('collection_id', library); return request('/api/videos', { method: 'POST', body: form }); };
  try {
    const setup = await post('/api/auth/setup', { password: '0049' }); cookie = setup.headers.get('set-cookie').split(';')[0];
    const a = await (await post('/api/collections', { name: '影片' })).json(), b = await (await post('/api/collections', { name: '复用' })).json();
    const responses = await Promise.all([upload(file, a.id), upload(file, b.id), upload(webm, a.id, '记录.webm')]);
    assert.ok(responses.every(r => r.status === 201)); const [mp4, shared, clip] = await Promise.all(responses.map(r => r.json()));
    assert.equal(mp4.kind, 'video'); assert.equal(mp4.mime, 'video/mp4'); assert.equal(clip.mime, 'video/webm'); assert.ok(mp4.duration > 1); assert.equal(mp4.width, 320); assert.equal(mp4.thumbnail_url, '/media/'+mp4.id+'/thumbnail');
    for(const item of [mp4,clip]){const r=await request(item.thumbnail_url);assert.equal(r.status,200);assert.match(r.headers.get('content-type'),/image\/webp/);const info=await sharp(Buffer.from(await r.arrayBuffer())).metadata();assert.ok(info.width<=480&&info.height<=480);}
    assert.equal((await request(mp4.thumbnail_url,{headers:{Cookie:''}})).status,401);
    assert.equal((await readdir(join(dir, 'media'))).length, 2); assert.equal([mp4, shared].filter(item => item.shared).length, 1);
    assert.equal((await (await upload(file, a.id)).json()).duplicate, true);
    assert.equal((await upload(Buffer.from('not video'), a.id)).status, 415);
    assert.equal((await upload(await readFile('public/icon.svg'), a.id)).status, 415);
    assert.equal((await request(mp4.url, { headers: { Cookie: '' } })).status, 401);
    const readToken = await (await post('/api/tokens', { name: '只读', scope: 'read' })).json();
    assert.equal((await request('/api/videos', { method: 'POST', headers: { Cookie: '', Authorization: 'Bearer ' + readToken.token } })).status, 403);
    const full = await request(mp4.url); assert.equal(full.headers.get('accept-ranges'), 'bytes'); assert.deepEqual(Buffer.from(await full.arrayBuffer()), file);
    for (const [range, start, end] of [['bytes=0-31',0,31],['bytes=32-',32,file.length-1],[`bytes=-16`,file.length-16,file.length-1]]) {
      const r = await request(mp4.url, { headers: { Range: range } }); assert.equal(r.status, 206); assert.equal(r.headers.get('content-range'), `bytes ${start}-${end}/${file.length}`); assert.deepEqual(Buffer.from(await r.arrayBuffer()), file.subarray(start, end + 1));
    }
    assert.equal((await request(mp4.url, { headers: { Range: `bytes=${file.length}-` } })).status, 416);
    assert.equal((await request(mp4.url, { headers: { Range: 'bytes=-0' } })).status, 416);
    const head = await request(mp4.url, { method: 'HEAD' }); assert.equal(head.headers.get('content-length'), String(file.length)); assert.equal((await head.arrayBuffer()).byteLength, 0);
    const fallback = await request(mp4.url, { headers: { Range: 'bytes=0-4', 'If-Range': '"old"' } }); assert.equal(fallback.status, 200);
    assert.equal((await (await request('/api/items?kind=video&tags=' + encodeURIComponent('["视频"]'))).json()).total, 3);
    assert.equal((await (await request('/api/items?gallery=true')).json()).ids.length, 0);
    const stats = await (await request('/api/storage')).json(); assert.equal(stats.videos, 2); assert.equal(stats.video_entries, 3);
    for (const mode of ['portable', 'html', 'images', 'backup']) {
      const response = await request('/api/export?mode=' + mode); assert.equal(response.status, 200);
      const entries = await unzip(Buffer.from(await response.arrayBuffer()));
      if (mode === 'images') { assert.equal(JSON.parse(entries.get('images.json')).images.length, 0); continue; }
      if (mode === 'backup') { assert.equal([...entries.keys()].filter(key => key.startsWith('data/media/')).length, 2); continue; }
      const manifest = JSON.parse(entries.get('manifest.json'));
      for (const item of manifest.items) assert.deepEqual(entries.get(item.file), item.mime === 'video/mp4' ? file : webm);
      if (mode === 'html') assert.match(entries.get('index.html').toString(), /<video controls/);
    }
    const saved = await (await post('/api/backups', {})).json();
    await post('/api/items', { title: '恢复前临时笔记' });
    const preview = await runtime.backups.preview(join(dir, 'backups', saved.id)); assert.equal(preview.unique_videos, 2);
    const result = await runtime.backups.restore(preview.id); assert.ok(result.restored);
    assert.equal(runtime.db.prepare("SELECT count(*) n FROM items WHERE kind='note'").get().n, 0);
    for (const item of runtime.db.prepare("SELECT * FROM items WHERE kind='video'").all()) assert.equal(digest(await originalBuffer(dir, item)), item.hash);
    await runtime.backups.stop(); await runtime.webhooks.stop(); await new Promise(r => server.close(r)); runtime.db.close();
    runtime = createApp({ dataDir: dir }); server = runtime.app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r)); base = `http://127.0.0.1:${server.address().port}`;
    const login = await post('/api/auth/login', { password: '0049' }); cookie = login.headers.get('set-cookie').split(';')[0];
    assert.equal((await request(mp4.url, { headers: { Range: 'bytes=0-10' } })).status, 206);
    assert.equal((await readdir(join(dir, 'uploads'))).length, 0);
    assert.equal((await request(mp4.thumbnail_url)).status,200,'cover regenerates after restore and restart');
  } finally { await runtime.backups.stop(); await runtime.webhooks.stop(); await new Promise(r => server.close(r)); runtime.db.close(); }
});

test('schema 3 migration preserves rows, original references and FTS while admitting videos', async () => {
  const dir = await mkdtemp(resolve('artifacts/video-migration-'));
  const db = new DatabaseSync(join(dir, 'znote.sqlite'));
  db.exec("CREATE TABLE items (id TEXT PRIMARY KEY,kind TEXT NOT NULL CHECK(kind IN ('note','image')),title TEXT NOT NULL,content TEXT NOT NULL DEFAULT '',tags TEXT NOT NULL DEFAULT '[]',collection_id TEXT,favorite INTEGER DEFAULT 0,file_key TEXT,thumbnail_key TEXT,mime TEXT,bytes INTEGER,width INTEGER,height INTEGER,hash TEXT,created_at TEXT,updated_at TEXT,deleted_at TEXT,version INTEGER DEFAULT 1,storage_codec TEXT DEFAULT 'identity',stored_bytes INTEGER,source_url TEXT,captured_at TEXT); CREATE VIRTUAL TABLE items_search USING fts5(title,content,tags,content='items',content_rowid='rowid',tokenize='trigram'); PRAGMA user_version=3;");
  const id = randomUUID(); db.prepare("INSERT INTO items(id,kind,title,content) VALUES(?,'note','迁移前的知识','检索保持可用')").run(id); const before = db.prepare('SELECT rowid,* FROM items').get(); db.close();
  const next = openDatabase(dir);
  try { const { duration, video_codec, group_key, group_index, group_title, group_order, group_manual, group_origin_id, ...after } = next.prepare('SELECT rowid,* FROM items').get(); assert.deepEqual(after, { ...before }); assert.equal(next.prepare('PRAGMA user_version').get().user_version, 13); assert.equal(next.prepare("SELECT count(*) n FROM items_search WHERE items_search MATCH '迁移前'").get().n, 1); next.prepare("INSERT INTO items(id,kind,title) VALUES(?,'video','视频')").run(randomUUID()); }
  finally { next.close(); }
});
