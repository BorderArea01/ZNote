import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import sharp from 'sharp';
import { chromium } from 'playwright';
import { createApp } from '../server/app.js';

const dir = await mkdtemp(resolve('artifacts/gallery-performance-'));
let runtime = createApp({ dataDir: dir, staticDir: resolve('artifacts/build-v03') });
let server = runtime.app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r)); let base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: 'msedge', headless: true }); const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage(), report = { notes: 10000, images: 1000, measurements: {} }, errors = [];
page.on('pageerror', e => errors.push(e.message));
const post = async (path, data) => { const r = await context.request.post(base + path, { data }); assert.ok(r.ok(), await r.text()); return r.json(); };
try {
  await post('/api/auth/setup', { password: '0013' });
  const gallery = await post('/api/collections', { name: '大图库验收' }), notes = await post('/api/collections', { name: '一万篇笔记' });
  const insert = runtime.db.prepare("INSERT INTO items(id,kind,title,content,tags,collection_id,created_at,updated_at) VALUES(?,'note',?,?,?,?,?,?)");
  runtime.db.exec('BEGIN');
  for (let i = 0; i < report.notes; i++) {
    const date = new Date(1700000000000 + i * 1000).toISOString();
    insert.run(randomUUID(), '知识条目 ' + i, i % 1000 === 0 ? '中文资料检索 uniqueLongMarker' : '知识积累与图片管理的日常记录。'.repeat(10), '["资料"]', notes.id, date, date);
  }
  runtime.db.exec('COMMIT');
  const originals = [];
  for (let i = 0; i < report.images; i++) {
    const png = await sharp({ create: { width: 1000, height: 700, channels: 3, background: { r: (i * 13) % 256, g: 110 + i % 110, b: 80 + i % 150 } } }).png().toBuffer();
    const r = await context.request.post(base + '/api/assets', { multipart: { file: { name: `图像${String(i).padStart(4, '0')}.png`, mimeType: 'image/png', buffer: png }, collection_id: gallery.id } });
    assert.ok(r.ok(), await r.text()); originals.push(await r.json());
  }
  const timings = [];
  for (let i = 0; i < 20; i++) {
    const start = performance.now(); const result = await (await context.request.get(base + '/api/items?q=uniqueLongMarker')).json(); timings.push(performance.now() - start); assert.equal(result.total, 10);
  }
  timings.sort((a, b) => a - b); report.measurements.search_p50_ms = timings[10]; report.measurements.search_p95_ms = timings[19];
  report.search_plan = runtime.db.prepare("EXPLAIN QUERY PLAN SELECT rowid FROM items_search WHERE content LIKE '%uniqueLongMarker%'").all();
  assert.ok(report.search_plan.some(p => p.detail.includes('VIRTUAL TABLE INDEX')));
  assert.ok(report.measurements.search_p95_ms < 1000, 'Indexed search should finish well below a second on this fixture');
  await context.request.patch(base + '/api/preferences', { data: { default_collection_id: gallery.id } });
  await runtime.backups.stop(); await runtime.webhooks.stop(); await new Promise(r => server.close(r)); runtime.db.close();
  runtime = createApp({ dataDir: dir, staticDir: resolve('artifacts/build-v03') }); server = runtime.app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r)); base = `http://127.0.0.1:${server.address().port}`;
  const requests = []; page.on('request', req => { if (req.url().includes('/media/')) requests.push(req.url()); });
  const start = performance.now(); await page.goto(base); await page.waitForFunction(() => document.querySelectorAll('.item-card').length === 60); report.measurements.initial_grid_ms = performance.now() - start;
  await page.waitForLoadState('networkidle');
  report.initial_thumbnail_requests = requests.filter(u => u.endsWith('/thumbnail')).length;
  assert.ok(report.initial_thumbnail_requests < 60, 'Offscreen thumbnails should remain lazy');
  assert.equal(await page.locator('.item-card').count(), 60);
  await page.getByLabel('排序方式').selectOption('title');
  await page.getByRole('button', { name: '打开 图像0000.png', exact: true }).waitFor();
  await page.waitForFunction(() => {
    const images = [...document.querySelectorAll('.item-card img')].filter(img => {
      const rect = img.getBoundingClientRect(); return rect.top < innerHeight && rect.bottom > 0;
    });
    return images.length > 0 && images.every(img => img.complete && img.naturalWidth > 0);
  });
  await page.screenshot({ path: resolve('artifacts/v03-large-gallery.png'), fullPage: false, animations: 'disabled' });
  await page.getByRole('button', { name: '打开 图像0059.png', exact: true }).click();
  await page.getByLabel('标题', { exact: true }).fill('Z-已整理-0059');
  await page.getByRole('button', { name: '下一张 →' }).click();
  await page.waitForFunction(() => document.querySelector('#item-title')?.value === '图像0060.png');
  await page.getByRole('button', { name: '← 上一张' }).click();
  await page.waitForFunction(() => document.querySelector('#item-title')?.value === 'Z-已整理-0059');
  await page.getByLabel('标题', { exact: true }).fill('图像0059.png');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  report.cross_page_navigation = true;
  report.cross_page_after_title_edits = true;
  const concurrent = await Promise.all(originals.slice(0, 32).map(i => context.request.get(base + i.thumbnail_url)));
  assert.ok(concurrent.every(r => r.ok()));
  report.worker = runtime.diagnostics(); assert.equal(report.worker.thumbnail_peak, 2); assert.ok(report.worker.preview_cache_bytes <= 32 * 1024 * 1024);
  await page.getByRole('button', { name: '关闭窗口' }).click(); await page.getByRole('button', { name: '加载更多内容', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.item-card').length === 120);
  for (let count = 120; count < report.images; count += 60) {
    await page.getByRole('button', { name: '加载更多内容', exact: true }).click();
    await page.waitForFunction(expected => document.querySelectorAll('.item-card').length === expected, Math.min(report.images, count + 60));
  }
  const paintStart = performance.now(); await page.getByRole('button', { name: '打开 图像0999.png', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#item-title')?.value === '图像0999.png'); report.measurements.open_last_image_ms = performance.now() - paintStart;
  assert.deepEqual(errors, []);
  await writeFile(resolve('artifacts/v03-performance.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); await runtime.backups.stop(); await runtime.webhooks.stop(); await new Promise(r => server.close(r)); runtime.db.close(); }
