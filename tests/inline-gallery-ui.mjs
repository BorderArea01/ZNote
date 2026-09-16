import { chromium } from 'playwright';
import { mkdtemp } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import sharp from 'sharp';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';
import { originalBuffer } from '../server/storage.js';

const dir = await mkdtemp(resolve('artifacts/gallery-save-'));
const runtime = createApp({ dataDir: join(dir, 'data'), staticDir: resolve('dist') });
const server = runtime.app.listen(0, '127.0.0.1');
await new Promise(r => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;
const images = await Promise.all(['#518878', '#a57960', '#7273a5'].map(background => sharp({ create: { width: 1600, height: 1000, channels: 3, background } }).png().toBuffer()));
const small = await sharp(images[0]).resize(48, 48).jpeg().toBuffer();
const extension = resolve('addons/browser/clipper');
const context = await chromium.launchPersistentContext(join(dir, 'profile'), { channel: 'msedge', headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`], viewport: { width: 1440, height: 1050 } });
const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
const errors = [], sourceHeaders = [];
let failThird = true, slowSecond = false, loseResponse = false, posts = 0, uploadGate;
await context.route('https://**/*', async route => {
  const u = new URL(route.request().url()); sourceHeaders.push(route.request().headers());
  if (u.hostname === 'i.pximg.net'||/^(img|file)\.pawchive\.(pw|st)$/.test(u.hostname)) {
    const i = Number(u.pathname.match(/_p(\d)/)?.[1] || 0);
    if(u.hostname.startsWith('file.pawchive'))return route.fulfill({contentType:'image/png',body:images[i===1?0:i]});
    if (!u.pathname.includes('original')) return route.fulfill({ contentType: 'image/jpeg', body: small });
    if (i === 2 && failThird) return route.fulfill({ status: 404 });
    if (i === 1 && slowSecond) await new Promise(r => setTimeout(r, 2000));
    return route.fulfill({ contentType: 'image/png', body: images[i] }).catch(() => {});
  }
  if(u.hostname==='example.org')return route.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><title>通用图集</title><article>'+[0,1,2].map(i=>`<img id="${i===0?'cover':'page'+i}" style="width:180px;height:120px" src="https://file.pawchive.pw/data/work_p${i}.png">`).join('')+'</article>'});
  if(/^pawchive\./.test(u.hostname))return route.fulfill({headers:{'Content-Security-Policy':"frame-src 'none'"},contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><main><h1>Paw 顺序图集</h1>'+[0,1,2].map(i=>`<figure><a href="https://file.pawchive.pw/data/work_p${i}.png"><img id="${i===0?'cover':'page'+i}" style="width:180px;height:120px" src="https://img.pawchive.pw/thumbnail/work_p${i}.png"></a></figure>`).join('')+'</main>'});
  if (u.pathname.startsWith('/ajax/illust/')) return route.fulfill({ json: { body: u.pathname.endsWith('/pages') ? [0, 1, 2].map(i => ({ urls: { original: `https://i.pximg.net/img-original/12345_p${i}.png`, regular: `https://i.pximg.net/img-master/12345_p${i}.jpg` } })) : { title: '晨间色彩 · 三页作品', pageCount: 3 } } });
  return route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><style>body{margin:40px}img{width:48px;height:48px}</style><h1>作者作品</h1><a href="/artworks/12345"><img id="cover" src="https://i.pximg.net/tiny/12345_p0.jpg"></a>' });
});
await context.route(base + '/api/assets', async route => {
  posts++;
  const response = await route.fetch();
  if (uploadGate) { const gate = uploadGate; uploadGate = null; gate.seen(); await gate.wait; }
  if (loseResponse) { loseResponse = false; return route.abort('failed'); }
  return route.fulfill({ response });
});
const page = await context.newPage();page.on('pageerror',e=>errors.push(e.message));
const rows = collection => runtime.db.prepare('SELECT * FROM items WHERE collection_id=?').all(collection);
async function openSave(target) {
  const shown=page.locator('[data-znote-overlay]').locator('.inline-save:not([hidden]) iframe:not([hidden])');if(await shown.count()){const frame=await(await shown.elementHandle()).contentFrame();await frame.getByRole('button',{name:'收起入库窗口'}).click();await page.locator('[data-znote-overlay]').locator('.inline-save').waitFor({state:'hidden'});}
  await page.bringToFront(); await page.locator('#cover').hover();
  const preview = page.locator('[data-znote-overlay]').locator('.preview');
  await preview.getByText('1 / 3', { exact: true }).waitFor();
  if(target!==undefined){await preview.getByRole('button',{name:'目标知识库',exact:true}).click();const choice=preview.getByRole('combobox',{name:'图片入库目标知识库',exact:true});const index=await choice.evaluate((el,value)=>[...el.options].findIndex(o=>o.value===value),target);await choice.focus();await choice.press('Home');for(let i=0;i<index;i++)await choice.press('ArrowDown');await choice.press('Enter');await preview.getByRole('button',{name:'批量入库 3 张',exact:true}).waitFor();await page.waitForTimeout(150);}
  const before=context.pages().length;
  await preview.getByRole('button',{name:'批量入库 3 张',exact:true}).click();
  const selector=page.locator('[data-znote-overlay]').locator('.inline-save iframe:not([hidden])');await selector.waitFor();
  const frame=await(await selector.elementHandle()).contentFrame();try{await frame.locator('#collection option').first().waitFor({state:'attached',timeout:6000});}catch(e){console.log('NAV',await worker.evaluate(async()=>{const tabs=await chrome.tabs.query({url:'https://www.pixiv.net/*'});return chrome.webNavigation.getAllFrames({tabId:tabs[0].id})}));console.log('INLINE FRAME',await frame.locator('body').innerText());await page.screenshot({path:resolve('artifacts/v0928-inline-failure.png')});throw e;}assert.equal(context.pages().length,before,'Inline save never creates a browser tab');
  const gallery=new Proxy(frame,{get(target,key){if(key==='screenshot')return options=>page.screenshot(options);if(key==='setViewportSize')return size=>page.setViewportSize(size);if(key==='reload')return ()=>target.goto(target.url());const v=target[key];return typeof v==='function'?v.bind(target):v;}});

  return gallery;
}
try {
  assert.ok((await context.request.post(base + '/api/auth/setup', { data: { password: '0059' } })).ok());
  const token = await (await context.request.post(base + '/api/tokens', { data: { name: '批量入库测试', scope: 'write' } })).json();
  const a = await (await context.request.post(base + '/api/collections', { data: { name: '默认素材库' } })).json();
  const b = await (await context.request.post(base + '/api/collections', { data: { name: '插画收藏' } })).json();
  await worker.evaluate(config => chrome.storage.local.set(config), { server: base, token: token.token, collection_id: a.id, tags: '插画,晨间' });
  await page.goto('https://www.pixiv.net/users/1/artworks');
  await page.locator('[data-znote-overlay]').waitFor({ state: 'attached' });
  let gallery = await openSave(b.id);
  assert.equal(page.url(),'https://www.pixiv.net/users/1/artworks');
  assert.equal(await gallery.locator('#collection').inputValue(),b.id,'One-click save uses the selected preview destination');
  assert.ok(await page.locator('.inline-save iframe').evaluate(frame=>frame.contentDocument===null),'Host page cannot read extension form or credentials');
  await page.evaluate(()=>{const frame=document.querySelector('[data-znote-overlay]').shadowRoot.querySelector('iframe');frame.contentWindow.postMessage({type:'save-all'},'*');});
  assert.equal((await worker.evaluate(() => chrome.downloads.search({}))).length, 0);

  await gallery.locator('#save-status').filter({ hasText: '已入库 2 / 3 张，1 张失败' }).waitFor();
  assert.equal(rows(a.id).length, 0); assert.equal(rows(b.id).length, 2); assert.equal(posts, 2);
  await worker.evaluate(config => chrome.storage.local.set(config), { collection_id: a.id, tags: '改过的默认标签' });
  const resumeUrl=gallery.url();
  await page.reload();
  await page.locator('.inline-save-badge').click();
  gallery=page.frames().find(f=>f.url()===resumeUrl);
  assert.ok(gallery,'Reload restores unfinished inline job');
  await gallery.locator('#save:not([disabled])').waitFor();
  assert.equal(posts,2,'Reload only restores progress; no automatic upload');
  assert.equal(await gallery.locator('#collection').inputValue(), b.id); assert.ok(await gallery.locator('#collection').isDisabled());
  failThird = false;
  await gallery.locator('#save').click(); await gallery.getByRole('button', { name: '全部已入库', exact: true }).waitFor();
  assert.equal(posts, 3); assert.equal(rows(b.id).length, 3); assert.equal(rows(a.id).length, 0);
  assert.ok(rows(b.id).every(r=>r.group_key==='pixiv:art:12345'));assert.deepEqual(rows(b.id).map(r=>r.group_index).sort(),[0,1,2]);
  for (const row of rows(b.id)) {
    const i = Number(row.title.match(/(\d{3})$/)[1]) - 1;
    assert.deepEqual(await originalBuffer(join(dir, 'data'), row), images[i]);
    assert.equal(row.source_url, 'https://www.pixiv.net/artworks/12345');
    assert.ok(row.content.includes(`页码：${i + 1} / 3`));
    for (const tag of ['插画', '晨间', 'Pixiv']) assert.ok(JSON.parse(row.tags).includes(tag), row.tags);
  }
  await page.screenshot({ path: resolve('artifacts/v0928-inline-save.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await gallery.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: resolve('artifacts/v0928-inline-save-mobile.png'), fullPage: true });
  await page.setViewportSize({width:1440,height:1050});
  slowSecond = true;
  const retry = await openSave(); await retry.locator('#save-status').filter({ hasText: '正在入库 2 / 3' }).waitFor();
  await retry.getByRole('button',{name:'收起入库窗口'}).click();
  await page.locator('.inline-save-badge').filter({hasText:'入库中'}).waitFor();
  await page.locator('.inline-save-badge').click();
  assert.equal(page.frames().filter(f=>f.url()===retry.url()).length,1,'Minimize/reopen retains the running frame');
  await retry.locator('#save-cancel').click(); await retry.locator('#save-status').filter({ hasText: '已停止。已入库 1 / 3' }).waitFor();
  assert.equal(rows(a.id).length, 1);
  slowSecond = false; loseResponse = true;
  await retry.locator('#save').click(); await retry.locator('#save-status').filter({ hasText: '已入库 2 / 3 张，1 张失败' }).waitFor();
  assert.equal(rows(a.id).length, 3, 'Lost response may still have committed on the server');
  const beforeRetry = posts;
  await retry.locator('#save').click(); await retry.getByRole('button', { name: '全部已入库', exact: true }).waitFor();
  assert.equal(posts, beforeRetry + 1); assert.equal(rows(a.id).length, 3, 'Retry of ambiguous result deduplicates in selected library');
  assert.ok((await retry.locator('#pages').textContent()).includes('已收录'));
  const ticket = new URL(retry.url()).searchParams.get('id');
  const stored = await worker.evaluate(key => chrome.storage.session.get(key), 'gallery-' + ticket);
  assert.ok(!JSON.stringify(stored).includes(token.token), 'Job ticket must not store credentials');
  const direct=await context.newPage();await direct.goto(retry.url());await direct.locator('#save-status').filter({hasText:'过期'}).waitFor();assert.ok(await direct.locator('#save').isDisabled());await direct.close();
  assert.ok(sourceHeaders.every(h => !h.authorization), 'No knowledge-base token sent to image hosts');
  assert.equal((await worker.evaluate(() => chrome.downloads.search({}))).length, 0, 'Bulk save must not trigger browser downloads');
  const c = await (await context.request.post(base + '/api/collections', { data: { name: '停止上传验证' } })).json();
  let release, seen;
  const intercepted = new Promise(r => { seen = r; });
  uploadGate = { seen, wait: new Promise(r => { release = r; }) };
  const stopped = await openSave(c.id); await intercepted;
  await stopped.locator('#save-cancel').click();
  await stopped.locator('#save-status').filter({ hasText: '等待当前上传确认' }).waitFor();
  release();
  await stopped.locator('#save-status').filter({ hasText: '已停止。已入库 1 / 3' }).waitFor();
  assert.equal(rows(c.id).length, 1, 'Stop confirms the active upload and never starts the next image');
  const pawLibrary=await(await context.request.post(base+'/api/collections',{data:{name:'Paw 图集'}})).json();
  await page.goto('https://pawchive.pw/fanbox/user/1/post/2?from=creator');await page.locator('[data-znote-overlay]').waitFor({state:'attached'});
  const paw=await openSave(pawLibrary.id);await paw.getByRole('button',{name:'全部已入库',exact:true}).waitFor();
  await page.screenshot({path:resolve('artifacts/v0928-paw-inline.png'),fullPage:true});
  const pawRows=rows(pawLibrary.id).sort((a,b)=>a.group_index-b.group_index);assert.equal(pawRows.length,3);assert.ok(pawRows.every(r=>r.group_key==='paw:fanbox:1:2'));assert.deepEqual(pawRows.map(r=>r.group_index),[0,1,2]);assert.equal(pawRows[0].hash,pawRows[1].hash);assert.notEqual(pawRows[0].id,pawRows[1].id);
  const grouped=await(await context.request.get(base+'/api/items?collection='+pawLibrary.id+'&grouped=true')).json();assert.equal(grouped.total,1);assert.equal(grouped.items[0].group_count,3);assert.equal(grouped.items[0].id,pawRows[0].id);
  await page.goto('https://pawchive.st/fanbox/user/1/post/2?from=another');await page.locator('[data-znote-overlay]').waitFor({state:'attached'});const mirror=await openSave();assert.equal(await mirror.locator('#collection').inputValue(),pawLibrary.id,'Last destination is remembered across pages');await mirror.getByRole('button',{name:'全部已入库',exact:true}).waitFor();assert.equal(rows(pawLibrary.id).length,3,'Mirror and tracking parameters do not duplicate the work');
  const genericLibrary=await(await context.request.post(base+'/api/collections',{data:{name:'通用网页'}})).json();await page.goto('https://example.org/article?id=2');await page.locator('[data-znote-overlay]').waitFor({state:'attached'});const generic=await openSave(genericLibrary.id);await generic.getByRole('button',{name:'全部已入库',exact:true}).waitFor();assert.equal(rows(genericLibrary.id).length,3);assert.equal(new Set(rows(genericLibrary.id).map(r=>r.group_key)).size,1);assert.ok(rows(genericLibrary.id).every(r=>r.group_key.startsWith('web:gallery:')));
  const beforeMissing=posts;await worker.evaluate(()=>chrome.storage.local.set({collection_id:'deleted-library'}));
  const missing=await openSave();await missing.locator('#save-status').filter({hasText:'已不存在'}).waitFor();assert.equal(posts,beforeMissing,'Missing default must never upload into unfiled');
  await missing.locator('#collection').selectOption(genericLibrary.id);await missing.locator('#save:not([disabled])').waitFor();assert.equal(posts,beforeMissing,'Repairing destination still requires explicit resume');await missing.locator('#save').click();await missing.getByRole('button',{name:'全部已入库',exact:true}).waitFor();assert.equal((await worker.evaluate(()=>chrome.storage.local.get('collection_id'))).collection_id,genericLibrary.id);
  assert.deepEqual(errors, []);
  console.log('PASS: real Edge extension bulk-save; Pixiv and Paw grouped with source order and first-page cover; identical pages retained; mirror reimport deduplicates; library isolation, partial failure, stop, refresh and retry; original bytes and token isolation; mobile layout');
} catch(e) {
  console.log('BATCH STATES',await Promise.all(page.frames().filter(f=>f.url().includes('/batch.html')).map(async f=>({url:f.url(),body:await f.locator('body').innerText().catch(()=>'(gone)')}))));
  await page.screenshot({path:resolve('artifacts/v0928-inline-failure.png')});throw e;
} finally {
  await context.close(); await runtime.imports.stop(); await runtime.backups.stop(); await runtime.webhooks.stop();
  await new Promise(r => server.close(r)); runtime.db.close();
}

