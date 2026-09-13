import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createApp } from '../server/app.js';

const dir = await mkdtemp(resolve('artifacts/note-concurrent-'));
const runtime = createApp({ dataDir: dir, staticDir: resolve(process.env.UI_DIST || 'dist') });
const server = runtime.app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
const base = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext(), pages = await Promise.all([context.newPage(), context.newPage()]);
const errors = []; pages.forEach(p => p.on('pageerror', e => errors.push(e.message)));
const dialog = p => p.getByRole('dialog', { name: '图文笔记', exact: true });
const body = p => p.getByRole('textbox', { name: '笔记正文', exact: true });
const saved = p => dialog(p).getByRole('status').filter({ hasText: '草稿已保存在此浏览器' }).waitFor();
const post = async (path, data) => { const r = await context.request.post(base + path, { data }); assert.ok(r.ok(), await r.text()); return r.json(); };
try {
  await post('/api/auth/setup', { password: '0916' });
  const note = await post('/api/items', { title: '并行写作', content: '已提交正文' });
  await context.request.patch(base + '/api/preferences', { data: { default_collection_id: 'unfiled' } });
  for (const p of pages) {
    await p.goto(base); await p.getByRole('button', { name: '打开 并行写作', exact: true }).click();
    await dialog(p).getByRole('button', { name: '编辑', exact: true }).click();
    await body(p).waitFor();
  }
  const [a, b] = pages;
  await body(a).fill('窗口 A 的独立草稿'); await saved(a);
  await body(b).fill('窗口 B 的独立草稿'); await saved(b);
  const rows = await a.evaluate(() => new Promise((resolve, reject) => {
    const r = indexedDB.open('znote-writing'); r.onerror = () => reject(r.error);
    r.onsuccess = () => { const db = r.result, tx = db.transaction('drafts'), q = tx.objectStore('drafts').getAll(); q.onsuccess = () => resolve(q.result); tx.oncomplete = () => db.close(); };
  }));
  assert.equal(rows.length, 2); assert.equal(new Set(rows.map(r => r.id)).size, 2);
  assert.deepEqual(new Set(rows.map(r => r.fields.content)), new Set(['窗口 A 的独立草稿', '窗口 B 的独立草稿']));
  await body(a).press('Control+s');
  await a.waitForFunction(() => [...document.querySelectorAll('.toast')].some(n => n.textContent.includes('已保存')));
  const response = b.waitForResponse(r => r.url() === base + '/api/items/' + note.id && r.request().method() === 'PATCH');
  await dialog(b).getByRole('button', { name: '保存', exact: true }).click(); assert.equal((await response).status(), 409);
  assert.equal(await body(b).inputValue(), '窗口 B 的独立草稿');
  assert.equal(runtime.db.prepare('SELECT content FROM items WHERE id=?').get(note.id).content, '窗口 A 的独立草稿');
  await dialog(b).getByRole('button', { name: '关闭窗口', exact: true }).click();
  await b.getByRole('button', { name: '打开 并行写作', exact: true }).click();
  await b.getByRole('button', { name: '对照草稿', exact: true }).click();
  assert.equal(await b.getByRole('textbox', { name: '知识库当前正文', exact: true }).inputValue(), '窗口 A 的独立草稿');
  assert.equal(await b.getByRole('textbox', { name: '本地草稿正文', exact: true }).inputValue(), '窗口 B 的独立草稿');

  // Simulate a browser that rejects IndexedDB writes after the editor opens.
  await a.evaluate(() => {
    const original = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function(stores, mode, ...rest) {
      if (this.name === 'znote-writing' && mode === 'readwrite') throw new DOMException('No space', 'QuotaExceededError');
      return original.call(this, stores, mode, ...rest);
    };
  });
  await body(a).fill('存储空间不足时仍保留的文字');
  await dialog(a).getByRole('status').filter({ hasText: '草稿保存失败' }).waitFor();
  const confirmEvent = a.waitForEvent('dialog');
  const closing = dialog(a).getByRole('button', { name: '关闭窗口', exact: true }).click();
  const confirmation = await confirmEvent; assert.equal(confirmation.type(), 'confirm'); await confirmation.dismiss();
  await closing;
  assert.equal(await body(a).inputValue(), '存储空间不足时仍保留的文字');
  const downloading = a.waitForEvent('download');
  await dialog(a).getByRole('button', { name: '导出当前正文为 Markdown', exact: true }).click();
  assert.equal(await readFile(await (await downloading).path(), 'utf8'), '存储空间不足时仍保留的文字');
  await dialog(a).getByRole('button', { name: '保存', exact: true }).click();
  await a.waitForFunction(() => [...document.querySelectorAll('.toast')].some(n => n.textContent.includes('已保存')));
  assert.equal(runtime.db.prepare('SELECT content FROM items WHERE id=?').get(note.id).content, '存储空间不足时仍保留的文字');
  assert.deepEqual(errors, []);
  console.log('PASS Edge: independent two-tab drafts, Ctrl+S, atomic version conflict, current-server comparison, storage failure, protected close and exact Markdown fallback');
} finally {
  await browser.close(); await runtime.trash.stop(); await runtime.imports.stop(); await runtime.backups.stop(); await runtime.webhooks.stop();
  await new Promise(r => server.close(r)); runtime.db.close();
}
