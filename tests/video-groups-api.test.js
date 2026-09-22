import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
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
    const order = await (await request(`/api/item-groups/order?id=${first.id}`)).json();
    assert.equal(order.kind, 'video');
    assert.deepEqual(order.items.map(item => item.kind), ['video', 'video']);
    const recovered = await (await request(`/api/item-groups/order?id=${randomUUID()}&kind=video&collection=${collection.id}&group_key=upload%3Avideo%3Atest-group`)).json();
    assert.deepEqual(recovered.items.map(item => item.id), [first.id, second.id], 'stable group identity recovers a stale cover id');
    const reordered = await request('/api/item-groups/order', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: first.id, revision: order.revision, ids: [second.id, first.id] }) });
    assert.equal(reordered.status, 200);
    assert.deepEqual((await reordered.json()).items.map(item => item.id), [second.id, first.id]);
    const current = await Promise.all([first.id, second.id].map(id => request('/api/items/' + id).then(response => response.json())));
    const organizeInput = { items: current.map(item => ({ id: item.id, version: item.version })), collection_id: collection.id, kind: 'video', mode: 'create', title: '重新整理的视频组', whole_groups: false, target_id: null, note_mode: 'copy' };
    const previewResponse = await request('/api/item-groups/organize/preview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(organizeInput) });
    assert.equal(previewResponse.status, 200);
    const preview = await previewResponse.json();
    assert.equal(preview.input.kind, 'video');
    assert.equal(preview.result_count, 2);
    const organizedResponse = await request('/api/item-groups/organize', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...preview.input, revision: preview.revision, operation_id: preview.operation_id, prepared_at: preview.prepared_at, undo: true }) });
    assert.equal(organizedResponse.status, 200);
    const organized = await organizedResponse.json();
    assert.equal(organized.changed_count, 2);
    assert.equal((await (await request(`/api/item-groups?collection=${collection.id}&kind=video`)).json()).groups[0].kind, 'video');
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
