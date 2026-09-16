import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { cleanNote, markerFor, normalizeBase, publish } from '../skills/znote-conversation-notes/scripts/znote-note.mjs';

test('normalizes a safe ZNote base URL', () => {
  assert.equal(normalizeBase('http://localhost:3741/'), 'http://localhost:3741');
  assert.throws(() => normalizeBase('http://token@example.com'), /无凭据/);
});

test('adds the conversation tag and produces a stable private marker', () => {
  const note = cleanNote({ title: '缓存为什么会失效', content: '正文', tags: ['缓存'], images: [] });
  assert.deepEqual(note.tags, ['缓存', 'AI 对话整理']);
  assert.equal(markerFor(note, null), markerFor(note, null));
  assert.notEqual(markerFor(note, null), markerFor({ ...note, content: '另一份正文' }, null));
});

test('rejects unsafe or incomplete note manifests', () => {
  assert.throws(() => cleanNote({ title: '', content: '正文' }), /title/);
  assert.throws(() => cleanNote({ title: '标题', content: '正文', source_url: 'file:///secret' }), /HTTP/);
});

test('publishes once and recognizes the same note on retry', async t => {
  let saved = null;
  const server = createServer(async (request, response) => {
    assert.equal(request.headers.authorization, 'Bearer zn_test_token_for_mock_only');
    response.setHeader('content-type', 'application/json');
    if (request.method === 'GET' && request.url.startsWith('/api/items?')) {
      response.end(JSON.stringify({ items: saved ? [saved] : [] }));
      return;
    }
    if (request.method === 'POST' && request.url === '/api/items') {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks));
      assert.equal(body.collection_id, null);
      assert.deepEqual(body.tags, ['知识管理', 'AI 对话整理']);
      assert.equal(body.content.includes('zn_test_token_for_mock_only'), false);
      saved = { ...body, id: 'note-1', version: 1 };
      response.statusCode = 201;
      response.end(JSON.stringify(saved));
      return;
    }
    response.statusCode = 404;
    response.end('{}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const folder = await mkdtemp(join(tmpdir(), 'znote-skill-'));
  const input = join(folder, 'note.json');
  await writeFile(input, JSON.stringify({ title: '从对话到学习笔记', content: '# 核心结论\n\n保留推理，删除噪声。', tags: ['知识管理'] }));
  const config = { baseUrl: `http://127.0.0.1:${server.address().port}`, token: 'zn_test_token_for_mock_only', defaultCollectionId: null };
  const first = await publish(config, input);
  const second = await publish(config, input);
  assert.equal(first.created, true);
  assert.equal(second.duplicate, true);
  assert.equal(second.item.id, 'note-1');
});
