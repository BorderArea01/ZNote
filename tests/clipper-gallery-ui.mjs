import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { createApp } from '../server/app.js';

const dir = await mkdtemp(resolve('artifacts/clipper-gallery-ui-'));
const image = await sharp({ create: { width: 24, height: 24, channels: 3, background: '#7a967e' } }).png().toBuffer();
const fixture = '<script>window.__INITIAL_STATE__=' + JSON.stringify({ note: { noteDetailMap: { abcd: { note: { noteId: 'abcd', title: '小红书图组验收', desc: '两张图', user: { nickname: '测试作者' }, imageList: [{ urlDefault: 'https://sns.example/one.jpg' }, { urlDefault: 'https://sns.example/two.jpg' }] } } } } }) + '</script>';
const runtime = createApp({ dataDir: dir, staticDir: resolve('dist'), captureOptions: { page: async () => ({ url: 'https://www.xiaohongshu.com/explore/abcd', type: 'text/html', buffer: Buffer.from(fixture) }), image: async () => image } });
const server = runtime.app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const extension = resolve('addons/browser/clipper');
const context = await chromium.launchPersistentContext(join(dir, 'profile'), { channel: process.env.EXTENSION_BROWSER || 'msedge', headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`], viewport: { width: 1200, height: 850 } });
const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
const id = new URL(worker.url()).host;
try {
  const page = await context.newPage(); await page.goto(base);
  await page.getByLabel('访问密码').fill('0038'); await page.getByRole('button', { name: '开始使用 ZNote' }).click();
  await page.getByRole('heading', { name: /我的知识库/ }).waitFor();
  const token = await (await context.request.post(base + '/api/tokens', { data: { name: '图组入口测试', scope: 'write' } })).json();
  const options = await context.newPage(); await options.goto(`chrome-extension://${id}/options.html`); await options.waitForFunction(() => document.body.dataset.ready === 'true');
  await options.locator('#server').fill(base); await options.locator('#token').fill(token.token); await options.getByRole('button', { name: '验证连接并读取知识库' }).click(); await options.getByText('连接成功，请选择知识库并保存设置', { exact: true }).waitFor();
  await options.getByRole('button', { name: '保存设置', exact: true }).click(); await options.getByText('已保存，可以右键图片或截图入库', { exact: true }).waitFor();
  const tab = await context.newPage(); await tab.goto('https://www.xiaohongshu.com/explore/abcd'); await tab.bringToFront();
  const popup = await context.newPage(); await popup.goto(`chrome-extension://${id}/popup.html`);
  await popup.locator('#gallery-link').fill('分享给你 https://xhslink.com/a/abcd'); await popup.getByRole('button', { name: '获取图组并保存' }).click();
  await popup.locator('#gallery-status').waitFor({ state: 'visible' }); await popup.waitForFunction(() => /图片组已入库/.test(document.querySelector('#gallery-status')?.textContent || ''), null, { timeout: 10000 });
  assert.equal(await popup.locator('#gallery-open').getAttribute('href') !== null, true);
  const jobs = await (await context.request.get(base + '/api/captures')).json(); assert.equal(jobs.jobs.length, 1); assert.equal(jobs.jobs[0].status, 'completed');
  assert.equal(runtime.db.prepare("SELECT count(*) AS n FROM items WHERE group_key LIKE 'capture:%'").get().n, 2);
  console.log('PASS: extension popup submits an XHS share link through the group capture queue and reports the completed grouped result');
} finally {
  await context.close(); await runtime.captures.stop(); await runtime.imports.stop(); await runtime.trash.stop(); await runtime.backups.stop(); await runtime.webhooks.stop(); await new Promise(resolve => server.close(resolve)); runtime.db.close();
}
