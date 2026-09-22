import { chromium } from 'playwright';
import { copyFile, mkdir, mkdtemp, readFile, stat } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';

const dataDir = await mkdtemp(resolve('artifacts/note-video-preview-ui-'));
const runtime = createApp({ dataDir, staticDir: resolve(process.env.UI_DIST || 'dist') });
const server = runtime.app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 1200, height: 800 }, hasTouch: true, isMobile: true });
const page = await context.newPage();

const post = async (path, data) => {
  const response = await context.request.post(base + path, { data });
  assert.ok(response.ok(), await response.text());
  return response.json();
};

try {
  await post('/api/auth/setup', { password: 'note-video-ui' });
  const library = await post('/api/collections', { name: '预览回归' });
  const note = await post('/api/items', {
    title: '有目录的笔记',
    collection_id: library.id,
    content: '# 总览\n\n正文。\n\n## 第一部分\n\n内容。\n\n### 细节\n\n更多内容。',
  });

  await mkdir(join(dataDir, 'media'), { recursive: true });
  const fixture = resolve('tests/fixtures/sample.mp4');
  const fileKey = 'preview-ui.mp4';
  await copyFile(fixture, join(dataDir, 'media', fileKey));
  const bytes = (await stat(fixture)).size;
  const hash = createHash('sha256').update(await readFile(fixture)).digest('hex');
  const now = new Date().toISOString();
  for (let index = 0; index < 2; index++) {
    runtime.db.prepare(`INSERT INTO items(
      id,kind,title,content,tags,collection_id,favorite,file_key,thumbnail_key,mime,bytes,width,height,hash,
      created_at,updated_at,storage_codec,stored_bytes,duration,video_codec,group_key,group_index,group_title
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      randomUUID(), 'video', `视频 ${index + 1}`, '', '[]', library.id, 0, fileKey, null, 'video/mp4', bytes,
      320, 240, hash, now, now, 'identity', bytes, 1.7, 'AVC', 'ui:video-group', index, '预览视频组',
    );
  }
  await context.request.patch(base + '/api/preferences', { data: { default_collection_id: library.id } });

  await page.goto(`${base}/?item=${note.id}`);
  const noteDialog = page.getByRole('dialog', { name: '图文笔记', exact: true });
  await noteDialog.getByRole('button', { name: '预览', exact: true }).click();
  await noteDialog.locator('.note-toc').waitFor();
  assert.equal(await noteDialog.locator('.note-toc a').count(), 3);
  assert.deepEqual(await noteDialog.locator('.markdown-preview h1, .markdown-preview h2, .markdown-preview h3').evaluateAll(nodes => nodes.map(node => node.id)), [
    'note-heading-总览-1', 'note-heading-第一部分-2', 'note-heading-细节-3',
  ]);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await noteDialog.locator('.note-toc a').filter({ hasText: '细节' }).tap();

  await noteDialog.getByRole('button', { name: '关闭窗口', exact: true }).click();
  if (await page.getByRole('button', { name: '打开导航', exact: true }).count()) await page.getByRole('button', { name: '打开导航', exact: true }).tap();
  await page.getByRole('button', { name: /^预览回归\s*2$/ }).click();
  await page.getByRole('button', { name: '打开 预览视频组', exact: true }).click();
  const videoDialog = page.getByRole('dialog', { name: '视频详情', exact: true });
  await videoDialog.locator('.gallery-strip').waitFor();
  await page.waitForFunction(() => document.querySelectorAll('.gallery-strip-list > button[role="option"]').length === 2);
  assert.equal(await videoDialog.locator('.gallery-strip-list > button[role="option"]').count(), 2);
  await videoDialog.getByRole('button', { name: '展开全部', exact: true }).tap();
  assert.equal(await videoDialog.locator('.gallery-strip-list > button[role="option"]').count(), 2);
  await videoDialog.getByRole('option', { name: '查看第 2 个视频', exact: true }).tap();
  await page.waitForFunction(() => document.querySelector('#item-title')?.value === '视频 2');
  await videoDialog.getByRole('button', { name: '调整顺序', exact: true }).tap();
  const orderDialog = page.getByRole('dialog', { name: '调整视频顺序', exact: true });
  await orderDialog.locator('.order-card').nth(1).waitFor();
  assert.equal(await orderDialog.locator('.order-card').count(), 2);
  await orderDialog.getByRole('button', { name: '取消', exact: true }).click();
  console.log('PASS: note TOC anchors and grouped video preview strip/order');
} finally {
  await browser.close();
  await runtime.imports.stop();
  await runtime.backups.stop();
  await runtime.webhooks.stop();
  await new Promise(resolve => server.close(resolve));
  runtime.db.close();
}
