import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import sharp from 'sharp';
import { createApp } from '../server/app.js';
import { compressLargeImage } from '../server/image-limits.js';
import { originalBuffer } from '../server/storage.js';

test('large image original, explicit compression, thumbnail and restart', async t => {
  await mkdir(resolve('artifacts'), { recursive: true });
  const dataDir = await mkdtemp(resolve('artifacts/large-image-'));
  const runtime = createApp({ dataDir });
  const server = runtime.app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  t.after(async () => { await runtime.backups.stop(); await new Promise(r => server.close(r)); runtime.db.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const auth = await fetch(base + '/api/auth/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: '0427' }) });
  const Cookie = auth.headers.get('set-cookie').split(';')[0];
  const original = await sharp(randomBytes(3100 * 3100 * 3), { raw: { width: 3100, height: 3100, channels: 3 } }).png().toBuffer();
  assert.ok(original.length > 25 * 1048576);
  async function upload(mode) {
    const body = new FormData(); body.set('file', new Blob([original]), 'large.png'); body.set('title', mode || 'original');
    if (mode) body.set('image_size_mode', mode);
    const response = await fetch(base + '/api/assets', { method: 'POST', headers: { Cookie }, body });
    const item = await response.json(); assert.equal(response.status, 201, JSON.stringify(item)); return item;
  }
  const full = await upload();
  assert.equal(full.bytes, original.length);
  const row = runtime.db.prepare('SELECT * FROM items WHERE id=?').get(full.id);
  assert.deepEqual(await originalBuffer(dataDir, row), original);
  const compressed = await upload('compress');
  assert.ok(compressed.bytes <= 25 * 1048576);
  assert.equal(compressed.mime, 'image/webp');
  assert.match(compressed.content, /无法恢复原文件/);
  const compressedRow = runtime.db.prepare('SELECT * FROM items WHERE id=?').get(compressed.id);
  const metadata = await sharp(await originalBuffer(dataDir, compressedRow)).metadata();
  assert.equal(metadata.width, 3100); assert.equal(metadata.height, 3100);
  const backup = await fetch(base + '/api/backups', { method: 'POST', headers: { Cookie } });
  assert.ok(backup.ok, await backup.clone().text());
  const status = await (await fetch(base + '/api/backups', { headers: { Cookie } })).json();
  const archive = await (await fetch(base + `/api/backups/${status.backups[0].id}/download`, { headers: { Cookie } })).arrayBuffer();
  const form = new FormData(); form.set('file', new Blob([archive]), 'backup.zip');
  const preview = await fetch(base + '/api/backups/preview', { method: 'POST', headers: { Cookie }, body: form });
  assert.equal(preview.status, 200, await preview.clone().text());
  const reopened = createApp({ dataDir });
  try { assert.deepEqual(await originalBuffer(dataDir, reopened.db.prepare('SELECT * FROM items WHERE id=?').get(full.id)), original); }
  finally { reopened.db.close(); }
});

test('compression does not flatten animations or change small originals', async () => {
  const frames = Buffer.concat([Buffer.alloc(16, 20), Buffer.alloc(16, 240)]);
  const gif = await sharp(frames, { raw: {width:2,height:4,channels:4,pageHeight:2} }).gif({delay:[100,100]}).toBuffer();
  assert.equal((await sharp(gif).metadata()).pages, 2);
  assert.equal((await compressLargeImage(gif)).buffer, gif);
  const largeGif = Buffer.concat([gif, Buffer.alloc(25*1048576)]);
  await assert.rejects(compressLargeImage(largeGif), /动图暂不支持低损压缩/);
});
