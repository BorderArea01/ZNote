import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createApp } from '../server/app.js';

const dir = await mkdtemp(resolve('artifacts/webhooks-ui-')); let reply = 503, received = 0;
const receiver = createServer(async (req, res) => { for await (const chunk of req) {} received++; res.writeHead(reply).end(); }); receiver.listen(0, '127.0.0.1'); await new Promise(r => receiver.once('listening', r));
const runtime = createApp({ dataDir: dir, staticDir: resolve(process.env.UI_DIST || 'dist') }); const server = runtime.app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: 'msedge', headless: true }); const context = await browser.newContext({ viewport: { width: 1360, height: 1000 } }); const page = await context.newPage();
const errors = []; page.on('pageerror', e => errors.push(e.message));
try {
  await page.goto(base); await page.getByLabel('访问密码').fill('0028'); await page.getByRole('button', { name: '开始使用 ZNote' }).click(); await page.getByRole('heading', { name: /我的知识库/ }).waitFor();
  await page.getByRole('button', { name: '设置与连接', exact: true }).click();
  await page.getByLabel('Webhook 名称').fill('图片处理接收器'); await page.getByLabel('Webhook 接收地址').fill(`http://127.0.0.1:${receiver.address().port}/events`);
  await page.getByRole('button', { name: '创建事件订阅', exact: true }).click();
  await page.locator('.webhook-settings .secret code').waitFor(); assert.match(await page.locator('.webhook-settings .secret code').textContent(), /^whsec_/);
  await page.getByRole('button', { name: '已保存密钥' }).click();
  await context.request.post(base + '/api/items', { data: { title: '触发真实投递' } }); await runtime.webhooks.tick(); assert.equal(received, 1);
  await page.getByRole('button', { name: '查看 图片处理接收器 投递记录' }).click();
  const dialog = page.getByRole('dialog', { name: '图片处理接收器 · 投递记录' });
  await dialog.getByText('item.created · 等待重试', { exact: true }).waitFor(); await dialog.getByText('接收端返回 HTTP 503', { exact: true }).waitFor();
  await page.screenshot({ path: resolve('artifacts/v03-webhook-deliveries.png'), fullPage: true, animations: 'disabled' });
  reply = 204; await dialog.getByRole('button', { name: '重新投递', exact: true }).click();
  await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(b => b.textContent === '重新投递')?.disabled);
  await runtime.webhooks.tick(); await dialog.getByText('item.created · 已送达', { exact: true }).waitFor(); assert.equal(received, 2);
  await dialog.getByRole('button', { name: '关闭窗口' }).click();
  await page.getByRole('button', { name: '暂停 图片处理接收器' }).click(); await page.getByRole('button', { name: '启用 图片处理接收器' }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 }); await page.locator('.webhook-settings').scrollIntoViewIfNeeded();
  await page.screenshot({ path: resolve('artifacts/v03-webhook-mobile.png'), fullPage: true, animations: 'disabled' }); assert.deepEqual(errors, []);
  console.log('PASS: browser creates subscription, shows secret once, displays real failed/successful deliveries, retries and pauses');
} catch (e) { await page.screenshot({ path: resolve('artifacts/v03-webhook-ui-failure.png'), fullPage: true }); throw e; }
finally { await browser.close(); await runtime.webhooks.stop(); await runtime.backups.stop(); await new Promise(r => server.close(r)); runtime.db.close(); await new Promise(r => receiver.close(r)); }
