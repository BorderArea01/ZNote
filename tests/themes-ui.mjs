import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { createApp } from '../server/app.js';

const dir = await mkdtemp(resolve('artifacts/themes-ui-'));
const runtime = createApp({ dataDir: dir, staticDir: resolve(process.env.UI_DIST || 'artifacts/build-themes') });
const server = runtime.app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, colorScheme: 'light' });
const page = await context.newPage(), errors = [], evidence = [];
page.on('pageerror', e => errors.push(e.message));
const post = async (path, data) => { const r = await context.request.post(base + path, { data }); assert.ok(r.ok(), await r.text()); return r.json(); };
const styleNames = { minimal: '简约', glass: '毛玻璃', cyber: '赛博朋克', paper: '纸感' };
const paletteNames = { forest: '松林绿', ocean: '海湾蓝', violet: '鸢尾紫', rose: '玫瑰粉', amber: '琥珀橙', slate: '石墨灰' };
const setStyle = async id => { await page.getByRole('button', { name: '风格：' + styleNames[id], exact: true }).click(); await page.waitForFunction(id => document.documentElement.dataset.style === id, id); };
const setMode = async mode => { await page.getByRole('button', { name: mode === 'dark' ? '夜间' : '浅色', exact: true }).click(); await page.waitForFunction(mode => document.documentElement.dataset.theme === mode, mode); };
const shot = async name => { await page.screenshot({ path: resolve(`artifacts/theme-${name}.png`), animations: 'disabled', fullPage: false }); };
const luminance = rgb => {
  const values = rgb.match(/[\d.]+/g).slice(0, 3).map(Number).map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; });
  return .2126 * values[0] + .7152 * values[1] + .0722 * values[2];
};
const contrast = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
try {
  await post('/api/auth/setup', { password: '0051' });
  const library = await post('/api/collections', { name: '灵感收藏' });
  for (let i = 0; i < 3; i++) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="560"><rect width="800" height="560" fill="${['#c5d9d2','#d4d5e7','#eedcc7'][i]}"/><circle cx="570" cy="160" r="65" fill="#fff6d7"/><path d="M0 510L240 180L490 520L640 340L800 560H0" fill="${['#608d82','#8d8aaa','#b29370'][i]}"/><path d="M0 530L390 340L800 550V560H0" fill="${['#355f57','#5e6388','#81644d'][i]}"/></svg>`;
    const buffer = await sharp(Buffer.from(svg)).png().toBuffer();
    const r = await context.request.post(base + '/api/assets', { multipart: { file: { name: ['山野之间.png','暮色远山.png','暖日漫游.png'][i], mimeType: 'image/png', buffer }, collection_id: library.id, tags: '["自然","配色灵感"]' } }); assert.ok(r.ok());
  }
  await post('/api/items', { title: '留住此刻的灵感', content: '# 日常观察\n\n记录沿途的颜色、光线与值得回看的画面。\n\n> 每一张图片，都有自己的故事。\n\n- 收集素材\n- 整理标签', collection_id: library.id, tags: ['随记'] });
  await context.request.patch(base + '/api/preferences', { data: { default_collection_id: library.id } });
  await page.goto(base); await page.locator('.item-card').first().waitFor();
  await page.getByRole('button', { name: '设置与连接', exact: true }).click();
  const colors = {};
  for (const mode of ['light', 'dark']) {
    await setMode(mode);
    for (const style of Object.keys(styleNames)) {
      await setStyle(style);
      for (const palette of ['minimal', 'glass'].includes(style) ? Object.keys(paletteNames) : ['fixed']) {
        if (palette !== 'fixed') await page.getByRole('button', { name: '色调：' + paletteNames[palette], exact: true }).click();
        // Finish cosmetic transitions before sampling rendered contrast.
        await page.evaluate(() => document.getAnimations().forEach(animation => animation.finish()));
        const actual = await page.evaluate(() => {
          const body = getComputedStyle(document.body), button = getComputedStyle(document.querySelector('.heading-actions .primary'));
          const selected = getComputedStyle(document.querySelector('.style-preset[aria-pressed="true"]'));
          return { body: body.color, canvas: body.backgroundColor, button: button.color, accent: button.backgroundColor, selectedText: selected.color, selectedBg: selected.backgroundColor,
            style: document.documentElement.dataset.style, palette: document.documentElement.dataset.palette };
        });
        assert.equal(actual.style, style); if (palette !== 'fixed') assert.equal(actual.palette, palette);
        assert.ok(contrast(actual.body, actual.canvas) >= 7, `${mode}/${style}/${palette} body contrast`);
        assert.ok(contrast(actual.button, actual.accent) >= 4.5, `${mode}/${style}/${palette} button contrast ${contrast(actual.button, actual.accent)}`);
        assert.ok(contrast(actual.selectedText, actual.selectedBg) >= 4.5, `${mode}/${style}/${palette} selected contrast`);
        if (style === 'minimal') colors[`${mode}/${palette}`] = actual.accent;
        evidence.push({ mode, style, palette, primary_contrast: contrast(actual.button, actual.accent) });
      }
    }
  }
  assert.equal(new Set(Object.values(colors)).size, 12);
  console.log('PASS: all four styles and six compatible palettes render in light/dark with readable body and primary controls');
  await setStyle('glass'); await page.getByRole('button', { name: '色调：鸢尾紫', exact: true }).click();
  await setMode('light');
  await shot('settings');
  await page.getByRole('button', { name: '关闭窗口' }).click();
  await page.reload(); await page.locator('.item-card').first().waitFor();
  assert.equal(await page.locator('html').getAttribute('data-style'), 'glass'); assert.equal(await page.locator('html').getAttribute('data-palette'), 'violet');
  await page.getByRole('button', { name: '设置与连接', exact: true }).click();
  await page.getByRole('button', { name: '跟随系统', exact: true }).click();
  await page.emulateMedia({ colorScheme: 'dark' }); await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await page.getByRole('button', { name: '关闭窗口' }).click();
  await page.getByRole('button', { name: '切换浅色模式', exact: true }).click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  assert.equal(await page.locator('html').getAttribute('data-style'), 'glass');
  console.log('PASS: style/palette persist across reload; system mode responds to OS and toolbar toggle follows resolved mode');
  for (const [style, mode] of [['minimal','light'], ['glass','light'], ['cyber','dark'], ['paper','light']]) {
    await page.getByRole('button', { name: '设置与连接', exact: true }).click(); await setStyle(style); await setMode(mode);
    await page.getByRole('button', { name: '关闭窗口' }).click();
    await page.waitForLoadState('networkidle'); await shot(style + '-desktop');
    const media = await page.locator('.card-preview img').first().evaluate(img => ({ filter: getComputedStyle(img).filter, opacity: getComputedStyle(img).opacity, loaded: img.complete && img.naturalWidth > 0 }));
    assert.deepEqual(media, { filter: 'none', opacity: '1', loaded: true });
    await page.setViewportSize({ width: 390, height: 844 }); await shot(style + '-mobile');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.setViewportSize({ width: 1440, height: 1050 });
  }
  await page.getByRole('button', { name: '打开 留住此刻的灵感', exact: true }).click();
  await page.getByRole('dialog', { name: '图文笔记' }).waitFor(); await shot('paper-note');
  await page.getByRole('button', { name: '关闭窗口' }).click();
  await page.getByRole('button', { name: '设置与连接', exact: true }).click(); await setStyle('cyber'); await setMode('dark');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('group', { name: '界面风格', exact: true }).scrollIntoViewIfNeeded(); await shot('settings-mobile');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  const bootstrap = await browser.newContext({ colorScheme: 'dark', javaScriptEnabled: true });
  try {
    await bootstrap.addInitScript(() => { localStorage.setItem('znote-theme', 'bad-value'); localStorage.setItem('znote-appearance', '{broken'); });
    const login = await bootstrap.newPage(); await login.goto(base); await login.getByLabel('访问密码').waitFor();
    assert.equal(await login.locator('html').getAttribute('data-style'), 'minimal'); assert.equal(await login.locator('html').getAttribute('data-theme'), 'dark');
  } finally { await bootstrap.close(); }
  assert.deepEqual(errors, []);
  await writeFile(resolve('artifacts/themes-verification.json'), JSON.stringify({ combinations: evidence, persistence: true, system_mode: true, mobile: true, image_pixels_unfiltered: true }, null, 2));
  console.log('PASS: all styles fit mobile, image elements stay unfiltered, note editor and settings work, invalid preferences fall back safely');
} catch (e) { await page.screenshot({ path: resolve('artifacts/themes-failure.png'), animations: 'disabled', fullPage: false }); throw e; }
finally { await browser.close(); await runtime.backups.stop(); await runtime.webhooks.stop(); await new Promise(r => server.close(r)); runtime.db.close(); }
