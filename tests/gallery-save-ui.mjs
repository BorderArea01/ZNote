import { chromium } from 'playwright';
import { mkdtemp } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import sharp from 'sharp';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';
import { originalBuffer } from '../server/storage.js';

const dir = await mkdtemp(resolve('artifacts/gallery-save-'));
const runtime = createApp({ dataDir: join(dir, 'data'), staticDir: resolve('dist') });
const server = runtime.app.listen(0, '127.0.0.1');
await new Promise(r => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;
const images = await Promise.all(['#518878', '#a57960', '#7273a5'].map(background => sharp({ create: { width: 1600, height: 1000, channels: 3, background } }).png().toBuffer()));
const small = await sharp(images[0]).resize(48, 48).jpeg().toBuffer();
const extension = resolve('extensions/clipper');
const context = await chromium.launchPersistentContext(join(dir, 'profile'), { channel: 'msedge', headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`], viewport: { width: 1440, height: 1050 } });
const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
const errors = [], sourceHeaders = [];
let failThird = true, slowSecond = false, loseResponse = false, posts = 0, uploadGate;
await context.route('https://**/*', async route => {
  const u = new URL(route.request().url()); sourceHeaders.push(route.request().headers());
  if (u.hostname === 'i.pximg.net') {
    const i = Number(u.pathname.match(/_p(\d)/)?.[1] || 0);
    if (!u.pathname.includes('original')) return route.fulfill({ contentType: 'image/jpeg', body: small });
    if (i === 2 && failThird) return route.fulfill({ status: 404 });
    if (i === 1 && slowSecond) await new Promise(r => setTimeout(r, 2000));
    return route.fulfill({ contentType: 'image/png', body: images[i] }).catch(() => {});
  }
  if (u.pathname.startsWith('/ajax/illust/')) return route.fulfill({ json: { body: u.pathname.endsWith('/pages') ? [0, 1, 2].map(i => ({ urls: { original: `https://i.pximg.net/img-original/12345_p${i}.png`, regular: `https://i.pximg.net/img-master/12345_p${i}.jpg` } })) : { title: '晨间色彩 · 三页作品', pageCount: 3 } } });
  return route.fulfill({ contentType: 'text/html', body: '<!doctype html><style>body{margin:40px}img{width:48px;height:48px}</style><h1>作者作品</h1><a href="/artworks/12345"><img id="cover" src="https://i.pximg.net/tiny/12345_p0.jpg"></a>' });
});
await context.route(base + '/api/assets', async route => {
  posts++;
  const response = await route.fetch();
  if (uploadGate) { const gate = uploadGate; uploadGate = null; gate.seen(); await gate.wait; }
  if (loseResponse) { loseResponse = false; return route.abort('failed'); }
  return route.fulfill({ response });
});
const page = await context.newPage();
const rows = collection => runtime.db.prepare('SELECT * FROM items WHERE collection_id=?').all(collection);
async function openSave() {
  await page.bringToFront(); await page.locator('#cover').hover();
  const preview = page.locator('[data-znote-overlay]').locator('.preview');
  await preview.getByText('1 / 3', { exact: true }).waitFor();
  const opened = context.waitForEvent('page');
  await preview.getByRole('button', { name: '批量入库 3 张', exact: true }).click();
  const gallery = await opened; gallery.on('pageerror', e => errors.push(e.message));
  await gallery.locator('#save:not([disabled])').waitFor();
  return gallery;
}
try {
  assert.ok((await context.request.post(base + '/api/auth/setup', { data: { password: '0059' } })).ok());
  const token = await (await context.request.post(base + '/api/tokens', { data: { name: '批量入库测试', scope: 'write' } })).json();
  const a = await (await context.request.post(base + '/api/collections', { data: { name: '默认素材库' } })).json();
  const b = await (await context.request.post(base + '/api/collections', { data: { name: '插画收藏' } })).json();
  await worker.evaluate(config => chrome.storage.local.set(config), { server: base, token: token.token, collection_id: a.id, tags: '默认标签' });
  await page.goto('https://www.pixiv.net/users/1/artworks');
  await page.locator('[data-znote-overlay]').waitFor({ state: 'attached' });
  const gallery = await openSave();
  assert.equal(await gallery.locator('#source').getAttribute('href'), 'https://www.pixiv.net/artworks/12345');
  assert.equal(posts, 0, 'Opening save UI must not write before choosing a destination');
  assert.equal((await worker.evaluate(() => chrome.downloads.search({}))).length, 0);
  await gallery.locator('#collection').selectOption(b.id); await gallery.locator('#tags').fill('插画,晨间');
  await gallery.locator('#save').click();
  await gallery.locator('#save-status').filter({ hasText: '已入库 2 / 3 张，1 张失败' }).waitFor();
  assert.equal(rows(a.id).length, 0); assert.equal(rows(b.id).length, 2); assert.equal(posts, 2);
  await worker.evaluate(config => chrome.storage.local.set(config), { collection_id: a.id, tags: '改过的默认标签' });
  await gallery.reload(); await gallery.locator('#save:not([disabled])').waitFor();
  assert.equal(await gallery.locator('#collection').inputValue(), b.id); assert.ok(await gallery.locator('#collection').isDisabled());
  failThird = false;
  await gallery.locator('#save').click(); await gallery.getByRole('button', { name: '全部已入库', exact: true }).waitFor();
  assert.equal(posts, 3); assert.equal(rows(b.id).length, 3); assert.equal(rows(a.id).length, 0);
  for (const row of rows(b.id)) {
    const i = Number(row.title.match(/(\d{3})$/)[1]) - 1;
    assert.deepEqual(await originalBuffer(join(dir, 'data'), row), images[i]);
    assert.equal(row.source_url, 'https://www.pixiv.net/artworks/12345');
    assert.ok(row.content.includes(`页码：${i + 1} / 3`));
    for (const tag of ['插画', '晨间', 'Pixiv']) assert.ok(JSON.parse(row.tags).includes(tag), row.tags);
  }
  await gallery.screenshot({ path: resolve('artifacts/v087-gallery-save.png'), fullPage: true });
  await gallery.setViewportSize({ width: 390, height: 844 });
  assert.ok(await gallery.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await gallery.screenshot({ path: resolve('artifacts/v087-gallery-save-mobile.png'), fullPage: true });
  const retry = await openSave();
  slowSecond = true;
  await retry.locator('#save').click(); await retry.locator('#save-status').filter({ hasText: '正在入库 2 / 3' }).waitFor();
  await retry.locator('#save-cancel').click(); await retry.locator('#save-status').filter({ hasText: '已停止。已入库 1 / 3' }).waitFor();
  assert.equal(rows(a.id).length, 1);
  slowSecond = false; loseResponse = true;
  await retry.locator('#save').click(); await retry.locator('#save-status').filter({ hasText: '已入库 2 / 3 张，1 张失败' }).waitFor();
  assert.equal(rows(a.id).length, 3, 'Lost response may still have committed on the server');
  const beforeRetry = posts;
  await retry.locator('#save').click(); await retry.getByRole('button', { name: '全部已入库', exact: true }).waitFor();
  assert.equal(posts, beforeRetry + 1); assert.equal(rows(a.id).length, 3, 'Retry of ambiguous result deduplicates in selected library');
  assert.ok((await retry.locator('#pages').textContent()).includes('已收录'));
  const ticket = new URL(retry.url()).searchParams.get('id');
  const stored = await worker.evaluate(key => chrome.storage.session.get(key), 'gallery-' + ticket);
  assert.ok(!JSON.stringify(stored).includes(token.token), 'Job ticket must not store credentials');
  assert.ok(sourceHeaders.every(h => !h.authorization), 'No knowledge-base token sent to image hosts');
  assert.equal((await worker.evaluate(() => chrome.downloads.search({}))).length, 0, 'Bulk save must not trigger browser downloads');
  const c = await (await context.request.post(base + '/api/collections', { data: { name: '停止上传验证' } })).json();
  const stopped = await openSave(); await stopped.locator('#collection').selectOption(c.id);
  let release, seen;
  const intercepted = new Promise(r => { seen = r; });
  uploadGate = { seen, wait: new Promise(r => { release = r; }) };
  await stopped.locator('#save').click(); await intercepted;
  await stopped.locator('#save-cancel').click();
  await stopped.locator('#save-status').filter({ hasText: '等待当前上传确认' }).waitFor();
  release();
  await stopped.locator('#save-status').filter({ hasText: '已停止。已入库 1 / 3' }).waitFor();
  assert.equal(rows(c.id).length, 1, 'Stop confirms the active upload and never starts the next image');
  assert.deepEqual(errors, []);
  console.log('PASS: hover bulk-save entry; explicit destination and tags; original bytes, Pixiv source and page numbers; library isolation; partial failure, stop, refresh and retry; ambiguous response deduplication; no automatic downloads or token leakage; mobile layout');
} finally {
  await context.close(); await runtime.imports.stop(); await runtime.backups.stop(); await runtime.webhooks.stop();
  await new Promise(r => server.close(r)); runtime.db.close();
}
