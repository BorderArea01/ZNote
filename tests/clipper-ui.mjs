import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, readFile, copyFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { createApp } from '../server/app.js';

const dir = await mkdtemp(resolve('artifacts/clipper-ui-'));
const runtime = createApp({ dataDir: dir, staticDir: resolve(process.env.UI_DIST || 'artifacts/build-v05'), importOptions: { downloader: async ({dir}) => { const path=join(dir,'media.mp4'); await copyFile('tests/fixtures/sample.mp4',path);return {path,originalname:'media.mp4',title:'插件视频'}; } } });
const server = runtime.app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r)); const base = `http://127.0.0.1:${server.address().port}`;
const png = await sharp({ create: { width: 600, height: 400, channels: 3, background: '#7a967e' } }).png().toBuffer();
const large = await sharp({ create: { width: 2400, height: 1600, channels: 3, background: '#687ca4' } }).png().toBuffer();
const requests = [];
const videoBytes = await readFile('tests/fixtures/sample.mp4');
const source = createServer((req, res) => {
  requests.push({ path: req.url, authorization: req.headers.authorization });
  if (req.url === '/video.mp4') { res.setHeader('Content-Type','video/mp4'); res.end(videoBytes); }
  else if (req.url === '/picture.png') { res.setHeader('Content-Type', 'image/png'); res.end(png); }
  else if (req.url === '/large.png') { res.setHeader('Content-Type', 'image/png'); res.end(large); }
  else if (req.url === '/unavailable.png') { res.statusCode = 404; res.end('not found'); }
  else if (req.url === '/hd') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end('<html><body><img width="300" sizes="300px" src="/picture.png" srcset="/picture.png 600w, /large.png 2400w" data-original="/unavailable.png"></body></html>'); }
  else { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end('<!doctype html><html><meta charset="utf-8"><title>采集测试页面</title><body style="font:24px sans-serif;background:#f2efe2;padding:30px"><h1>网页图片采集</h1><p>这是截图中的文字内容</p><img src="/picture.png"></body></html>'); }
}); source.listen(0, '127.0.0.1'); await new Promise(r => source.once('listening', r)); const sourceUrl = `http://127.0.0.1:${source.address().port}`;
const extension = resolve('addons/browser/clipper');
const context = await chromium.launchPersistentContext(join(dir, 'profile'), { channel: process.env.EXTENSION_BROWSER || 'msedge', headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`], viewport: { width: 1200, height: 850 } });
let worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker'); const id = new URL(worker.url()).host;
const page = await context.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
try {
  await page.goto(base); await page.getByLabel('访问密码').fill('0038'); await page.getByRole('button', { name: '开始使用 ZNote' }).click(); await page.getByRole('heading', { name: /我的知识库/ }).waitFor();
  const token = await (await context.request.post(base + '/api/tokens', { data: { name: '采集扩展测试', scope: 'write' } })).json();
  const collection = await (await context.request.post(base + '/api/collections', { data: { name: '网页采集' } })).json();
  const options = await context.newPage(); await options.goto(`chrome-extension://${id}/options.html`);
  await options.waitForFunction(() => document.body.dataset.ready === 'true');
  await options.locator('#server').fill(base); await options.locator('#token').fill(token.token); await options.getByRole('button', { name: '验证连接并读取知识库' }).click();
  await options.getByText('连接成功，请选择知识库并保存设置', { exact: true }).waitFor();
  await options.locator('#collection').selectOption(collection.id); await options.locator('#tags').fill('网页, 参考'); await options.getByRole('button', { name: '保存设置', exact: true }).click();
  await options.getByText('已保存，可以右键图片或截图入库', { exact: true }).waitFor();
  await options.screenshot({ path: resolve('artifacts/v03-clipper-settings.png'), fullPage: true });
  const tab = await context.newPage(); await tab.goto(sourceUrl); await tab.bringToFront();
  const result = await options.evaluate(async ({ sourceUrl }) => {
    const module = await import('./actions.js');
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await new Promise((yes, no) => chrome.contextMenus.update('znote-image', { title: '保存图片到 ZNote' }, () => chrome.runtime.lastError ? no(new Error(chrome.runtime.lastError.message)) : yes()));
    return module.record(() => module.collectImage({ srcUrl: sourceUrl + '/picture.png', pageUrl: sourceUrl }, tab));
  }, { sourceUrl });
  assert.equal(result.collection_id, collection.id); assert.deepEqual(result.tags, ['网页', '参考', '127.0.0.1']); assert.equal(result.source_url, sourceUrl); assert.ok(result.captured_at);
  assert.ok(result.content.includes('来源链接：' + sourceUrl));
  assert.deepEqual(await (await context.request.get(base + result.url)).body(), png);
  assert.ok(requests.every(r => !r.authorization));
  console.log('PASS: real extension connects using a write token; context-menu collector uploads original bytes, source, timestamp and tags without leaking the token to the source');
  await tab.keyboard.press('Alt+Shift+Z');
  const captured = await options.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const result = await chrome.runtime.sendMessage({ type: 'capture', tabId: tab.id });
    if (!result?.ok) throw new Error(result?.error || 'Background capture message was rejected');
    return result.item;
  });
  assert.equal(captured.source_url, sourceUrl + '/'); assert.equal(captured.mime, 'image/png');
  const screenshot = await (await context.request.get(base + captured.url)).body(); await writeFile(resolve('artifacts/v03-captured-page.png'), screenshot);
  const meta = await sharp(screenshot).metadata(); assert.equal(meta.width, 1200); assert.equal(meta.height, 850);
  assert.ok((await (await context.request.get(base + '/api/items?collection=' + collection.id)).json()).total >= 2);
  console.log('PASS: real captureVisibleTab screenshot is uploaded and restores as a valid PNG with viewport dimensions');
  await page.goto(base + '/#item/' + result.id); await page.getByRole('dialog', { name: '图片详情' }).waitFor();
  assert.equal(await page.getByRole('link', { name: '查看采集来源' }).getAttribute('href'), sourceUrl);
  const hd = await context.newPage(); await hd.goto(sourceUrl + '/hd'); await hd.bringToFront();
  await hd.locator('body > img').click({ button: 'right' });
  const currentSrc = await hd.locator('body > img').evaluate(img => img.currentSrc);
  assert.equal(currentSrc, sourceUrl + '/picture.png');
  const collect = () => options.evaluate(async ({ currentSrc, sourceUrl }) => {
    const module = await import('./actions.js'); const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return module.record(() => module.collectImage({ srcUrl: currentSrc, pageUrl: sourceUrl + '/hd', frameId: 0 }, tab));
  }, { currentSrc, sourceUrl });
  const original = await collect(); assert.equal(original.width, 2400); assert.equal(original.height, 1600);
  assert.deepEqual(await (await context.request.get(base + original.url)).body(), large);
  assert.ok(original.content.includes('/large.png')); assert.equal(original.source_url, sourceUrl + '/hd');
  await hd.locator('body > img').evaluate(img => { img.removeAttribute('srcset'); });
  await hd.locator('body > img').click({ button: 'right' });
  const fallback = await collect(); assert.equal(fallback.width, 600); assert.deepEqual(await (await context.request.get(base + fallback.url)).body(), png);
  assert.ok(requests.every(r => !r.authorization));
  console.log('PASS: real right-click content listener resolves 2400px srcset original, skips unavailable candidates, falls back to current image, and preserves exact bytes');
  const direct = await options.evaluate(async sourceUrl => { const {saveDirectVideo}=await import('./client.js'); return saveDirectVideo(sourceUrl+'/video.mp4',sourceUrl+'/video-page','网页直链视频'); },sourceUrl);
  assert.equal(direct.kind,'video'); assert.ok(direct.content.includes('来源链接：'+sourceUrl+'/video-page')); assert.deepEqual(await(await context.request.get(base+direct.url)).body(),videoBytes);
  const submitted=await options.evaluate(async()=>{const {collectVideo}=await import('./actions.js');return collectVideo({url:'https://x.com/test/status/123',title:'测试'});});
  let done;for(let i=0;i<100;i++){done=await(await context.request.get(base+'/api/imports/'+submitted.id)).json();if(done.status==='completed')break;await new Promise(r=>setTimeout(r,50));}
  assert.equal(done.status,'completed',done.message); assert.ok(requests.every(r=>!r.authorization));
  const popup=await context.newPage();await popup.goto(`chrome-extension://${id}/popup.html`);await popup.locator('#video-open:not([hidden])').waitFor();await popup.screenshot({path:resolve('artifacts/v05-clipper-popup.png')});
  assert.equal(await popup.locator('#video-open').getAttribute('href'),base+'/#item/'+done.item_id);
  console.log('PASS: extension direct video bytes/source, platform job submission, popup completion and open link');
  assert.deepEqual(errors, []);
} catch (e) { await page.screenshot({ path: resolve('artifacts/v03-clipper-ui-failure.png'), fullPage: true }); throw e; }
finally { await context.close(); await runtime.imports.stop(); await runtime.backups.stop(); await runtime.webhooks.stop(); await new Promise(r => server.close(r)); runtime.db.close(); await new Promise(r => source.close(r)); }
