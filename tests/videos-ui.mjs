import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { createApp } from '../server/app.js';
const dir = await mkdtemp(resolve('artifacts/videos-ui-'));
const runtime = createApp({ dataDir: dir, staticDir: resolve('artifacts/build-v04') });
const server = runtime.app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r)); const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: 'msedge', headless: true }); const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }); const page = await context.newPage(); const errors = [], ranges = [];
page.on('pageerror', e => errors.push(e.message)); page.on('response', r => { if (r.url().includes('/media/')) ranges.push(r.status()); });
try {
  await page.goto(base); await page.getByLabel('访问密码').fill('0072'); await page.getByRole('button', { name: '开始使用 ZNote' }).click();
  await page.getByRole('button', { name: '视频素材 0', exact: true }).click();
  await page.getByRole('button', { name: '上传视频', exact: true }).click();
  await page.getByRole('dialog').locator('input[type=file]').setInputFiles([resolve('tests/fixtures/sample.mp4'), resolve('tests/fixtures/sample.webm')]);
  await page.getByLabel('批量上传标签').fill('视频,参考'); await page.getByLabel('批量上传标签').press('Enter');
  await page.getByRole('button', { name: '开始上传', exact: true }).click();
  await page.getByRole('button', { name: '完成', exact: true }).waitFor(); await page.getByRole('button', { name: '关闭窗口' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.item-card').length === 2);
  await page.screenshot({ path: resolve('artifacts/v04-video-grid.png'), animations: 'disabled' });
  for (const name of ['sample.mp4', 'sample.webm']) {
    await page.getByRole('button', { name: '打开 ' + name, exact: true }).click();
    const video = page.locator('video'); await video.waitFor();
    await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
    await video.evaluate(async el => { el.muted = true; await el.play(); });
    await page.waitForFunction(() => document.querySelector('video')?.currentTime > .15);
    await video.evaluate(el => { el.pause(); el.currentTime = .8; });
    await page.waitForFunction(() => { const el = document.querySelector('video'); return el && !el.seeking && el.currentTime >= .75; });
    assert.equal(await video.evaluate(el => el.videoWidth), 320);
    await page.getByLabel('视频说明').fill('视频预览与拖动进度验证');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    if (name.endsWith('mp4')) {
      await page.screenshot({ path: resolve('artifacts/v04-video-preview.png'), animations: 'disabled' });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByRole('dialog').evaluate(el => { el.scrollTop = 0; });
      await page.screenshot({ path: resolve('artifacts/v04-video-mobile.png'), animations: 'disabled' });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.setViewportSize({ width: 1440, height: 1000 });
    }
    await page.getByRole('button', { name: '关闭窗口' }).click();
  }
  assert.ok(ranges.includes(206)); assert.deepEqual(errors, []);
  await page.getByRole('button', { name: '筛选标签：参考', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.item-card').length === 2);
  console.log('PASS: multi-video upload, tags, MP4 and WebM real playback, seeking, metadata save and mobile video layout');
} catch (e) { await page.screenshot({ path: resolve('artifacts/v04-video-ui-failure.png'), animations: 'disabled' }); throw e; }
finally { await browser.close(); await runtime.backups.stop(); await runtime.webhooks.stop(); await new Promise(r => server.close(r)); runtime.db.close(); }
