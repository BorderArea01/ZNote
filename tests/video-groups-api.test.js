import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createApp } from '../server/app.js';

async function start() {
  const dir = await mkdtemp(resolve('artifacts/video-groups-'));
  const runtime = createApp({ dataDir: dir });
  const server = runtime.app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const setup = await fetch(base + '/api/auth/setup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'video-group-test' }) });
  const cookie = setup.headers.get('set-cookie').split(';')[0];
  return { dir, runtime, server, base, cookie };
}

test('video uploads accept MKV and fold explicitly grouped videos into one card', async () => {
  const { dir, runtime, server, base, cookie } = await start();
  const request = (path, options = {}) => fetch(base + path, { ...options, headers: { Cookie: cookie, ...(options.headers || {}) } });
  try {
    const collection = await (await request('/api/collections', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: '视频组测试' }) })).json();
    const [mp4, mkv] = await Promise.all([
      readFile('tests/fixtures/sample.mp4'),
      readFile('tests/fixtures/sample.mkv'),
    ]);
    const upload = (buffer, name, index) => {
      const form = new FormData();
      form.set('file', new Blob([buffer]), name);
      form.set('title', name);
      form.set('collection_id', collection.id);
      form.set('group_key', 'upload:video:test-group');
      form.set('group_title', '测试视频组');
      form.set('group_index', String(index));
      return request('/api/videos', { method: 'POST', body: form });
    };
    const responses = await Promise.all([upload(mp4, '片段一.mp4', 0), upload(mkv, '片段二.mkv', 1)]);
    const responseBodies = await Promise.all(responses.map(response => response.clone().text()));
    assert.ok(responses.every(response => response.status === 201), responseBodies.join('\n'));
    const [first, second] = await Promise.all(responses.map(response => response.json()));
    assert.equal(first.mime, 'video/mp4');
    assert.equal(second.mime, 'video/x-matroska');
    assert.equal(second.url.endsWith('/original'), true);
    const thumb = await request(second.thumbnail_url);
    assert.equal(thumb.status, 200);
    assert.match(thumb.headers.get('content-type'), /image\/webp/);

    const grouped = await (await request(`/api/items?collection=${collection.id}&grouped=true`)).json();
    assert.equal(grouped.total, 1);
    assert.equal(grouped.items[0].kind, 'video');
    assert.equal(grouped.items[0].group_count, 2);
    assert.equal(grouped.items[0].group_size, 2);
    const gallery = await (await request(`/api/items?collection=${collection.id}&kind=video&group_key=upload%3Avideo%3Atest-group&gallery=true`)).json();
    assert.deepEqual(gallery.ids, [first.id, second.id]);
    const stats = await (await request(`/api/stats?collection=${collection.id}`)).json();
    assert.equal(stats.videos, 2);
    assert.equal(stats.video_cards, 1);
    assert.equal(stats.total_cards, 1);
  } finally {
    await runtime.imports.stop();
    await runtime.backups.stop();
    await runtime.webhooks.stop();
    await new Promise(resolve => server.close(resolve));
    runtime.db.close();
  }
});
