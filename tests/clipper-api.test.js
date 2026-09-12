import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createApp } from '../server/app.js';
import yauzl from 'yauzl';

test('clipper package and extension-origin authentication preserve cookie CSRF and token scopes', async t => {
  const dir = await mkdtemp(resolve('artifacts/clipper-api-')); const runtime = createApp({ dataDir: dir });
  const server = runtime.app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r)); const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await runtime.backups.stop(); await new Promise(r => server.close(r)); runtime.db.close(); });
  const setup = await fetch(base + '/api/auth/setup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: '0078' }) }); const cookie = setup.headers.get('set-cookie').split(';')[0];
  const token = async scope => (await (await fetch(base + '/api/tokens', { method: 'POST', headers: { Cookie: cookie, 'content-type': 'application/json' }, body: JSON.stringify({ name: scope, scope }) })).json()).token;
  const write = await token('write'), read = await token('read'), origin = 'chrome-extension://' + 'a'.repeat(32);
  const request = (headers, method = 'POST') => fetch(base + '/api/items', { method, headers: { 'content-type': 'application/json', ...headers }, body: method === 'POST' ? JSON.stringify({ title: '采集接口验证' }) : undefined });
  assert.equal((await request({ Origin: origin, Cookie: cookie })).status, 403);
  assert.equal((await request({ Origin: origin, Authorization: 'Bearer ' + write })).status, 201);
  assert.equal((await request({ Origin: origin, Authorization: 'Bearer ' + read })).status, 403);
  assert.equal((await request({ Origin: 'https://untrusted.example', Authorization: 'Bearer ' + write })).status, 403);
  assert.equal((await request({ Origin: origin }, 'GET')).status, 401);
  assert.equal((await fetch(base + '/api/clipper/download')).status, 401);
  const response = await fetch(base + '/api/clipper/download', { headers: { Cookie: cookie } }); assert.equal(response.status, 200);
  const buffer = Buffer.from(await response.arrayBuffer());
  const zip = await new Promise((yes, no) => yauzl.fromBuffer(buffer, { lazyEntries: true }, (e, zip) => e ? no(e) : yes(zip)));
  const files = new Map();
  await new Promise((yes, no) => {
    zip.on('error', no); zip.on('end', yes); zip.on('entry', entry => {
      zip.openReadStream(entry, (error, stream) => {
        if (error) { no(error); return; } const chunks = []; stream.on('data', c => chunks.push(c)); stream.on('error', no); stream.on('end', () => { files.set(entry.fileName, Buffer.concat(chunks).toString()); zip.readEntry(); });
      });
    }); zip.readEntry();
  });
  assert.equal(JSON.parse(files.get('manifest.json')).manifest_version, 3);
  for (const path of ['background.js', 'actions.js', 'client.js', 'options.html', 'popup.html', 'README.md','connect.js','preview-layout.js','article.html','article.js','vendor/article-extract.js','vendor/readability-LICENSE.md','vendor/turndown-LICENSE','vendor/turndown-gfm-LICENSE']) assert.ok(files.has(path));
  assert.ok(JSON.parse(files.get('manifest.json')).key);
  assert.ok(![...files.values()].some(text => text.includes(write)));
});
