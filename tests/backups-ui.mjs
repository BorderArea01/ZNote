import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createApp } from '../server/app.js';

const dir = await mkdtemp(resolve('artifacts/backups-ui-'));
const runtime = createApp({ dataDir: dir, staticDir: resolve('artifacts/build-v03') });
const server = runtime.app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 1360, height: 1050 } });
const page = await context.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
try {
  await page.goto(base); await page.getByLabel('访问密码').fill('0017'); await page.getByRole('button', { name: '开始使用 ZNote' }).click();
  await page.getByRole('heading', { name: /我的知识库/ }).waitFor();
  const created = await context.request.post(base + '/api/items', { data: { title: '网页恢复测试', content: '这段内容应能恢复', tags: ['保留标签'] } }); const note = await created.json();
  await page.getByRole('button', { name: '设置与连接', exact: true }).click();
  await page.getByLabel('备份间隔小时').fill('6'); await page.getByLabel('备份保留版本数').fill('3');
  await page.getByRole('button', { name: '保存备份设置', exact: true }).click();
  await page.getByRole('button', { name: '立即备份', exact: true }).click();
  await page.getByRole('link', { name: '下载完整备份', exact: true }).waitFor();
  let status = await (await context.request.get(base + '/api/backups')).json(); assert.equal(status.keep, 3); assert.equal(status.interval_hours, 6);
  await page.locator('.backup-settings').scrollIntoViewIfNeeded();
  await page.screenshot({ path: resolve('artifacts/v03-backup-settings.png'), fullPage: true, animations: 'disabled' });
  const downloadPromise = page.waitForEvent('download'); await page.getByRole('link', { name: '下载完整备份', exact: true }).click();
  const download = await downloadPromise; const downloaded = join(dir, 'browser-download.zip'); await download.saveAs(downloaded);
  assert.ok((await readFile(downloaded)).length > 0);
  await context.request.patch(base + '/api/items/' + note.id, { data: { version: note.version, title: '备份以后修改的标题' } });
  await page.getByLabel('上传完整备份').setInputFiles(downloaded);
  const preview = page.getByRole('dialog', { name: '恢复备份预览', exact: true }); await preview.waitFor();
  await preview.getByText(/校验通过/).waitFor();
  assert.equal(await preview.getByRole('button', { name: '恢复这个备份', exact: true }).isEnabled(), false);
  await page.screenshot({ path: resolve('artifacts/v03-backup-preview.png'), fullPage: true, animations: 'disabled' });
  await preview.getByRole('checkbox').check();
  await preview.getByRole('button', { name: '恢复这个备份', exact: true }).click();
  await page.getByLabel('访问密码').waitFor(); await page.getByLabel('访问密码').fill('0017');
  await page.getByRole('button', { name: '进入知识库', exact: true }).click();
  await page.getByRole('heading', { name: /我的知识库/ }).waitFor();
  const restored = await (await context.request.get(base + '/api/items/' + note.id)).json();
  assert.equal(restored.title, '网页恢复测试'); assert.deepEqual(restored.tags, ['保留标签']);
  status = await (await context.request.get(base + '/api/backups')).json(); assert.equal(status.backups.length, 2);
  await page.getByRole('button', { name: '设置与连接', exact: true }).click(); await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.backup-settings').scrollIntoViewIfNeeded();
  await page.screenshot({ path: resolve('artifacts/v03-backup-mobile.png'), fullPage: true, animations: 'disabled' });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); assert.deepEqual(errors, []);
  console.log('PASS: browser backup settings, download, upload preview, explicit confirmation, recovery login, restored data and mobile layout');
} catch (e) { await page.screenshot({ path: resolve('artifacts/v03-backup-ui-failure.png'), fullPage: true }); throw e; }
finally { await browser.close(); await runtime.backups.stop(); await new Promise(r => server.close(r)); runtime.db.close(); }
