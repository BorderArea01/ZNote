import { chromium } from 'playwright';
import { mkdtemp } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { createApp } from '../server/app.js';

const dir = await mkdtemp(resolve('artifacts/library-switch-'));
const runtime = createApp({ dataDir: dir, staticDir: resolve(process.env.UI_DIST || 'dist') });
const server = runtime.app.listen(0, '127.0.0.1');
await new Promise(r => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const errors = []; page.on('pageerror', e => errors.push(e.message));
const post = async (path, data) => { const r = await context.request.post(base + path, { data }); assert.ok(r.ok(), await r.text()); return r.json(); };
const choose = name => page.locator('.collections-nav').getByRole('button', { name: new RegExp('^' + name + ' ') }).click();
const category = name => page.locator('.sidebar nav').getByRole('button', { name: new RegExp('^' + name) }).click();
const loaded = () => page.waitForFunction(() => !document.querySelector('.loading-state'));
try {
  await post('/api/auth/setup', { password: '0911' });
  const libs = [];
  for (const [name, color] of [['摄影', '#7188bb'], ['插画', '#cc9988']]) {
    const lib = await post('/api/collections', { name });
    const buffer = await sharp({ create: { width: 1200, height: 800, channels: 3, background: color } }).png().toBuffer();
    const response = await context.request.post(base + '/api/assets', { multipart: { file: { name: name + '.png', mimeType: 'image/png', buffer }, collection_id: lib.id, tags: JSON.stringify([name]) } });
    assert.ok(response.ok()); const asset = await response.json();
    const note = await post('/api/items', { collection_id: lib.id, title: name + '笔记', favorite: true, content: `# ${name}\n\n![${name}配图](${asset.url})\n\n[来源](https://example.com/)` });
    libs.push({ ...lib, asset, note });
  }
  await context.request.patch(base + '/api/preferences', { data: { default_collection_id: libs[0].id } });
  await page.goto(base); await page.getByRole('button', { name: '打开 摄影笔记 · 配图', exact: true }).waitFor();
  // Real navigation, including re-entering an active library/category, without reload.
  for (const lib of [libs[1], libs[0], libs[0], libs[1]]) {
    await choose(lib.name);
    for (const name of ['全部内容', '图片素材', '图文笔记', '我的收藏', '全部内容']) {
      await category(name); await loaded();
      const names = await page.locator('.card-main').allTextContents();
      assert.ok(names.length > 0, `${lib.name}/${name} must load`);
      assert.ok(names.every(n => n.includes(lib.name)), 'only current library items');
    }
    await page.getByRole('button', { name: `打开 ${lib.name}笔记`, exact: true }).click();
    const img = page.locator('.markdown-preview img'); await img.scrollIntoViewIfNeeded();
    await img.evaluate(el => el.decode());
    assert.equal(await img.evaluate(el => el.naturalWidth), 1200);
    assert.equal(await img.getAttribute('src'), lib.asset.url);
    await page.getByRole('button', { name: '关闭窗口', exact: true }).click();
  }
  console.log('PASS: repeated library/category switches and actual Markdown image decoding without reload');
  // A debounced search from the old library must not hide the new library.
  await choose('摄影'); await loaded();
  await page.getByPlaceholder('搜索标题、正文或标签…').fill('只在旧库搜索的词');
  await choose('插画'); await loaded();
  await page.getByRole('button', { name: '打开 插画笔记 · 配图', exact: true }).waitFor();
  assert.equal(await page.getByPlaceholder('搜索标题、正文或标签…').inputValue(), '');
  // Hold a gallery response after it has left the API. Switching libraries must
  // invalidate both this response and any subsequent detail request.
  await choose('摄影'); await loaded();
  let release, arrived;
  const ready = new Promise(r => arrived = r), gate = new Promise(r => release = r);
  const delayed = async route => { const response = await route.fetch(); arrived(); await gate; await route.fulfill({ response }).catch(() => {}); };
  await page.route('**/api/items?*gallery=true*', delayed);
  await page.getByRole('button', { name: '连续浏览图片', exact: true }).click(); await ready;
  await choose('插画'); await loaded(); release();
  await page.waitForTimeout(300);
  assert.equal(await page.getByRole('dialog').count(), 0, 'old gallery must not reopen over new library');
  await page.unroute('**/api/items?*gallery=true*', delayed);
  await page.getByRole('button', { name: '打开 插画笔记', exact: true }).click();
  await page.locator('.markdown-preview img').evaluate(el => el.decode());
  await page.getByRole('button', { name: '关闭窗口', exact: true }).click();
  // A transient local image failure must be recoverable in place.
  let failImage = true;
  await page.route('**/media/' + libs[1].asset.id + '/original*', route => failImage ? route.fulfill({ status: 503, body: 'temporary' }) : route.continue());
  await page.getByRole('button', { name: '打开 插画笔记', exact: true }).click();
  await page.getByRole('button', { name: '重试图片', exact: true }).waitFor(); failImage = false;
  await page.getByRole('button', { name: '重试图片', exact: true }).click();
  await page.locator('.markdown-preview img').evaluate(el => el.decode());
  await page.screenshot({ path: resolve('artifacts/v091-library-note.png') });
  assert.deepEqual(errors, []);
  console.log('PASS: stale gallery discarded, new library usable, failed note image retries without page refresh');
} catch (e) { await page.screenshot({ path: resolve('artifacts/v091-library-failure.png') }); throw e; }
finally { await browser.close(); await runtime.imports.stop(); await runtime.backups.stop(); await runtime.webhooks.stop(); await new Promise(r => server.close(r)); runtime.db.close(); }
