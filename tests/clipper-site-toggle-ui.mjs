import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import assert from 'node:assert/strict';
const captureEvidence=async(target,options)=>{if(process.env.ZNOTE_SKIP_TEST_SCREENSHOTS==='1')return;await target.screenshot(options);};

const root = resolve('addons/browser/clipper');
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = resolve(root, '.' + (pathname === '/' ? '/popup.html' : pathname));
    if (file !== root && !file.startsWith(root + sep)) throw new Error('invalid path');
    const bytes = await readFile(file);
    response.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript; charset=utf-8' : file.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/html; charset=utf-8');
    response.end(bytes);
  } catch { response.writeHead(404); response.end('not found'); }
});
server.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: process.env.EXTENSION_BROWSER || 'msedge', headless: true });
const installMock = async (page, initial) => {
  await page.addInitScript(value => {
    let store = { ...value }, openedOptions = 0;
    const chromeMock = {
      tabs: { query: async () => [{ id: 23, url: 'https://www.example.com/gallery/1', title: '示例作品' }], create: async () => ({ id: 24 }) },
      storage: { local: { get: async keys => {
        if (Array.isArray(keys)) return Object.fromEntries(keys.filter(key => key in store).map(key => [key, store[key]]));
        if (typeof keys === 'string') return { [keys]: store[keys] };
        return { ...store };
      }, set: async next => { Object.assign(store, next); } } },
      runtime: { getURL: path => 'chrome-extension://test/' + path, sendMessage: async () => ({ ok: true }), openOptionsPage: async () => { openedOptions++; } },
      action: { setBadgeText: async () => {} },
    };
    Object.defineProperty(window, 'chrome', { configurable: true, value: chromeMock });
    window.__siteTestState = () => ({ ...store, openedOptions });
  }, initial);
  await page.goto(origin + '/popup.html');
  await page.waitForFunction(() => document.querySelector('#site-name')?.textContent === 'www.example.com');
};

try {
  const desktop = await browser.newPage({ viewport: { width: 440, height: 820 } });
  await installMock(desktop, { server: 'http://localhost:3741', blockedSites: [] });
  await captureEvidence(desktop,{ path: resolve('artifacts/clipper-site-toggle-popup-enabled.png') });
  await desktop.getByRole('button', { name: '禁用此网址' }).click();
  await desktop.getByRole('button', { name: '恢复此网址' }).waitFor();
  assert.deepEqual((await desktop.evaluate(() => window.__siteTestState())).blockedSites, ['www.example.com']);
  await captureEvidence(desktop,{ path: resolve('artifacts/clipper-site-toggle-popup.png') });
  await desktop.getByRole('button', { name: '恢复此网址' }).focus();
  await desktop.keyboard.press('Enter');
  await desktop.getByRole('button', { name: '禁用此网址' }).waitFor();
  assert.deepEqual((await desktop.evaluate(() => window.__siteTestState())).blockedSites, []);

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await installMock(mobile, { server: 'http://localhost:3741', blockedSites: [] });
  await mobile.getByRole('button', { name: '禁用此网址' }).tap();
  await mobile.getByRole('button', { name: '恢复此网址' }).waitFor();
  assert.deepEqual((await mobile.evaluate(() => window.__siteTestState())).blockedSites, ['www.example.com']);

  const inherited = await browser.newPage();
  await installMock(inherited, { server: 'http://localhost:3741', blockedSites: ['example.com'] });
  await inherited.getByRole('button', { name: '管理黑名单' }).click();
  assert.equal((await inherited.evaluate(() => window.__siteTestState())).openedOptions, 1);
  assert.deepEqual((await inherited.evaluate(() => window.__siteTestState())).blockedSites, ['example.com']);
  console.log('PASS: current-site blacklist toggle works by mouse, keyboard and touch; broad rules are preserved and routed to settings');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
