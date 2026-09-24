import { chromium } from 'playwright';
import { createApp } from '../server/app.js';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import sharp from 'sharp';

const dir = await mkdtemp(resolve('artifacts/folder-upload-ui-'));
const { app, db } = createApp({ dataDir: dir, staticDir: resolve('dist') });
const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
try {
  const page = await context.newPage(); await page.goto(base);
  await page.getByLabel('访问密码').fill('folder-test'); await page.getByRole('button', { name: '开始使用 ZNote' }).click(); await page.getByRole('heading', { name: /我的知识库/ }).waitFor();
  await page.getByRole('button', { name: '上传图片', exact: true }).click();
  const upload = page.getByRole('dialog', { name: '批量上传图片', exact: true });
  const folderPicker = upload.locator('input[webkitdirectory]'); assert.equal(await folderPicker.count(), 1);
  const png = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#789abc' } }).png().toBuffer();
  const folder = join(dir, '素材文件夹'); await mkdir(join(folder, 'nested'), { recursive: true });
  await writeFile(join(folder, 'one.png'), png); await writeFile(join(folder, 'nested', 'two.webp'), png); await writeFile(join(folder, 'readme.txt'), 'ignored');
  await folderPicker.setInputFiles(folder);
  assert.equal(await upload.locator('.upload-row').count(), 2);
  await upload.getByText(/已跳过 1 个不支持的文件/).waitFor();
  assert.equal(await upload.getByLabel('上传后组成图片组', { exact: true }).isChecked(), true);
  await upload.getByRole('button', { name: '开始上传', exact: true }).click(); await upload.getByRole('button', { name: '完成', exact: true }).waitFor();
  assert.equal(db.prepare("SELECT count(*) AS n FROM items WHERE kind='image'").get().n, 2);
  console.log('PASS: folder picker adds supported files, skips non-images, and uploads the folder contents as one image group');
} finally {
  await browser.close(); await new Promise(resolve => server.close(resolve)); db.close();
}
