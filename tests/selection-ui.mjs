import {chromium} from 'playwright';
import {mkdtemp} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {createApp} from '../server/app.js';
const dir=await mkdtemp(resolve('artifacts/selection-ui-'));
const runtime=createApp({dataDir:dir,staticDir:resolve(process.env.UI_DIST||'artifacts/build-v0930')}),server=runtime.app.listen(0,'127.0.0.1');
await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({channel:'msedge',headless:true}),context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage(),errors=[];
page.on('pageerror',e=>errors.push(e.message));
const post=async(path,data)=>{const r=await context.request.post(base+path,{data});assert.ok(r.ok(),await r.text());return r.json()};
const count=async n=>page.waitForFunction(n=>document.querySelector('.selection-count')?.textContent===`已选 ${n} 项`,n);
const ready=async()=>{await page.locator('.item-card').first().waitFor();await page.waitForFunction(()=>!document.querySelector('.loading-state'))};
try {
 await post('/api/auth/setup',{password:'0930'});
 const a=await post('/api/collections',{name:'整理工作台'}),b=await post('/api/collections',{name:'归档目标'});
 for(let i=0;i<125;i++)await post('/api/items',{title:`灵感 ${String(i).padStart(3,'0')}`,content:'# 灵感记录\n\n记录文字、链接和创作思路。',collection_id:a.id,tags:['待整理']});
 const other=await post('/api/items',{title:'另一知识库的笔记',collection_id:b.id,content:'保留',tags:['待整理']});
 await context.request.patch(base+'/api/preferences',{data:{default_collection_id:a.id}});
 await context.addInitScript(()=>localStorage.setItem('znote:auto-pages','false'));
 await page.goto(base);await ready();await page.getByLabel('排序方式').selectOption('title');await ready();
 await page.getByLabel('滚动自动加载',{exact:true}).uncheck();
 await page.locator('.card-main').nth(1).click({modifiers:['Control']});await count(1);await ready();
 await page.locator('.card-main').nth(4).click({modifiers:['Shift']});await count(4);
 await page.getByRole('button',{name:'反选已加载',exact:true}).click();await count(56);
 await page.keyboard.press('Escape');await count(0);
 await page.locator('.card-main').nth(0).click();await count(1);
 // Failed second page must keep the original single selection.
 let failNext=true;
 await page.route('**/api/items?**',async route=>{const p=new URL(route.request().url()).searchParams;if(failNext&&p.get('limit')==='100'&&p.get('offset')==='100'){failNext=false;await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'测试网络中断'})});}else await route.continue()});
 await page.getByRole('button',{name:'全选筛选结果',exact:true}).click();await page.getByText('测试网络中断',{exact:true}).waitFor();await count(1);
 // Cancelling a partially read selection does not erase prior choices.
 let release,arrive;const held=new Promise(r=>release=r),arrived=new Promise(r=>arrive=r);
 const hold=async route=>{const p=new URL(route.request().url()).searchParams;if(p.get('limit')==='100'&&p.get('offset')==='100'){arrive();await held;try{await route.continue()}catch{}}else await route.continue()};
 await page.route('**/api/items?**',hold);await page.getByRole('button',{name:'全选筛选结果',exact:true}).click();await arrived;
 await page.locator('.selection-progress').getByRole('button',{name:'取消',exact:true}).click();await count(1);release();await page.unroute('**/api/items?**',hold);
 await page.keyboard.press('Control+a');await count(125);
 // All selected rows, including those absent from DOM, receive fresh versions.
 await page.getByRole('button',{name:'批量标签',exact:true}).click();
 const tags=page.getByRole('dialog',{name:'批量标签 · 125 项内容'});
 await tags.getByPlaceholder('输入标签，回车或逗号添加').fill('已审核');await tags.getByPlaceholder('输入标签，回车或逗号添加').press('Enter');
 await tags.getByRole('button',{name:'应用标签',exact:true}).click();await tags.waitFor({state:'hidden'});await ready();await count(125);
 await page.getByRole('button',{name:'收藏所选',exact:true}).click();await page.getByRole('button',{name:'取消收藏',exact:true}).waitFor();await ready();await count(125);
 assert.equal(runtime.db.prepare('SELECT count(*) n FROM items WHERE collection_id=? AND favorite=1').get(a.id).n,125);
 assert.equal(runtime.db.prepare('SELECT favorite FROM items WHERE id=?').get(other.id).favorite,0);
 // Editing fields retain native select-all and Escape; dialogs do not leak shortcuts.
 await page.getByRole('button',{name:'批量标签',exact:true}).click();await tags.getByPlaceholder('输入标签，回车或逗号添加').fill('文本选择');await tags.getByPlaceholder('输入标签，回车或逗号添加').press('Control+a');await count(125);await page.keyboard.press('Escape');await tags.waitFor({state:'hidden'});await count(125);
 await page.getByRole('button',{name:'移动 / 收藏',exact:true}).click();const organize=page.getByRole('dialog',{name:'批量整理 125 项内容'});await organize.getByLabel('移动到知识库',{exact:true}).check();await organize.getByLabel('整理目标知识库').selectOption(b.id);await organize.getByRole('button',{name:'确认整理',exact:true}).click();await organize.waitFor({state:'hidden'});await count(0);
 assert.equal(runtime.db.prepare('SELECT count(*) n FROM items WHERE collection_id=?').get(a.id).n,0);
 assert.equal(runtime.db.prepare('SELECT count(*) n FROM items WHERE collection_id=?').get(b.id).n,126);
 // Restore batch move through the existing undo UI.
 await page.locator('.undo-notice').getByRole('button',{name:'撤销',exact:true}).click();await ready();assert.equal(runtime.db.prepare('SELECT count(*) n FROM items WHERE collection_id=?').get(a.id).n,125);
 await page.keyboard.press('Escape');await page.locator('.batch-toolbar').waitFor({state:'hidden'});await ready();
 // The floating entry works at the current scroll position on desktop and mobile.
 for(const viewport of [{width:1440,height:900},{width:390,height:844}]){
   await page.setViewportSize(viewport);await page.locator('.card-main').nth(20).scrollIntoViewIfNeeded();
   const entry=page.locator('.browse-window-actions button:visible, .floating-selection-entry:visible').filter({hasText:'多选'});await entry.waitFor();
   const anchor=await page.locator('.card-main').nth(20).evaluate(el=>({id:el.closest('.item-card').dataset.itemId,top:el.getBoundingClientRect().top}));
   await page.screenshot({path:resolve(`artifacts/selection-entry-${viewport.width}.png`)});
   await entry.click();await count(0);await ready();
   const card=page.locator(`[data-item-id="${anchor.id}"] .card-main`);const after=await card.evaluate(el=>el.getBoundingClientRect().top);
   assert.ok(Math.abs(anchor.top-after)<12,`Floating entry moved the card: ${anchor.top} -> ${after}`);
   const bar=await page.locator('.selection-bar').boundingBox();assert.ok(bar.y>=0&&bar.y+bar.height<viewport.height);assert.ok(bar.height<(viewport.width>760?70:120),`Selection toolbar is too tall: ${bar.height}`);
   await card.click();await count(1);await page.locator('.selection-operations').getByRole('button',{name:/^(收藏所选|取消收藏)$/}).click();await count(1);await page.waitForFunction(()=>!document.querySelector('.selection-working')&&!document.querySelector('.selection-exit')?.disabled);
   await page.keyboard.press('Escape');await count(0);await page.keyboard.press('Escape');await page.locator('.batch-toolbar').waitFor({state:'hidden'});await ready();
 }
 await page.setViewportSize({width:1440,height:900});
 // Enter and leave selection from a scrolled card using the keyboard.
 const card=page.locator('.card-main').nth(20);await card.scrollIntoViewIfNeeded();await card.focus();const before=await card.evaluate(el=>el.getBoundingClientRect().top);
 await page.keyboard.press('Control+Enter');await count(1);await ready();
 const after=await page.locator('.card-main').nth(20).evaluate(el=>el.getBoundingClientRect().top);assert.ok(Math.abs(before-after)<10,`Scroll anchor drift: ${before} -> ${after}`);
 await page.keyboard.press('Escape');await count(0);await page.keyboard.press('Escape');await page.locator('.batch-toolbar').waitFor({state:'hidden'});await ready();
 // Small multi-page artwork stays selectable as a complete group.
 for(let i=0;i<3;i++){
   const buffer=await sharp({create:{width:600,height:420,channels:3,background:['#829ac3','#bba7d9','#dda686'][i]}}).png().toBuffer();
   const r=await context.request.post(base+'/api/assets',{multipart:{title:`插画 ${i+1}`,collection_id:a.id,group_key:'test:series',group_index:String(i),group_title:'暮色画集',tags:JSON.stringify([i?'内部页':'封面']),file:{name:`page-${i}.png`,mimeType:'image/png',buffer}}});assert.ok(r.ok(),await r.text());
 }
 await page.getByRole('button',{name:/^图片素材/}).click();await ready();
 await page.locator('.select-group-button').first().click();await count(3);await ready();
 await page.locator('.select-group-button').first().click();await count(0);await page.locator('.select-group-button').first().click();await count(3);
 // Selection badge and action bar remain usable in both dark and narrow layouts.
 await page.getByRole('button',{name:'切换夜间模式',exact:true}).click();
 await page.waitForTimeout(350);await page.locator('.toast').waitFor({state:'hidden'});await page.locator('.batch-toolbar').evaluate(el=>window.scrollBy(0,el.getBoundingClientRect().top-12));await page.screenshot({path:resolve('artifacts/v0930-selection-desktop.png')});
 await page.setViewportSize({width:390,height:844});await page.locator('.batch-toolbar').evaluate(el=>window.scrollBy(0,el.getBoundingClientRect().top-12));assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.screenshot({path:resolve('artifacts/v0930-selection-mobile.png')});
 assert.deepEqual(errors,[]);console.log('PASS Edge: Ctrl/Shift selection, inversion, all 125 unloaded/filter-scoped rows, network failure preservation, consecutive tags/favorite/move, isolation, undo, Escape/dialog isolation, scroll anchor, group toggle, dark/mobile layout');
} catch(e) {await page.screenshot({path:resolve('artifacts/v0930-selection-failure.png')}).catch(()=>{});throw e;} finally {await page.unrouteAll({behavior:'ignoreErrors'});await browser.close();await runtime.weixin.stop();await runtime.trash.stop();await runtime.imports.stop();await runtime.backups.stop();await runtime.webhooks.stop();await new Promise(r=>server.close(r));runtime.db.close()}
