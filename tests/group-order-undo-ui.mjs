import {chromium} from 'playwright';
import {mkdtemp} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {createApp} from '../server/app.js';
const dir=await mkdtemp(resolve('artifacts/order-undo-ui-')),runtime=createApp({dataDir:dir,staticDir:resolve(process.env.UI_DIST||'dist')}),server=runtime.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({channel:'msedge',headless:true}),context=await browser.newContext({viewport:{width:1366,height:768}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
const post=async(path,data)=>{const r=await context.request.post(base+path,{data});assert.ok(r.ok(),await r.text());return r.json();};
const get=async path=>{const r=await context.request.get(base+path);assert.ok(r.ok(),await r.text());return r.json();};
const dialog=name=>page.getByRole('dialog',{name,exact:true}),order=dialog('调整图片顺序'),image=dialog('图片详情'),noteDetail=dialog('图文笔记');
const orderIds=async id=>(await get('/api/item-groups/order?id='+id)).items.map(i=>i.id);
async function sort(detail,button){await detail.getByRole('button',{name:button,exact:true}).click();await order.locator('.order-card').nth(2).waitFor();await order.locator('.order-card').last().dragTo(order.locator('.order-card').first());await order.getByRole('button',{name:'保存顺序',exact:true}).click();await order.waitFor({state:'hidden'});await detail.getByRole('button',{name:'撤销排序',exact:true}).waitFor();}
try{
  await post('/api/auth/setup',{password:'0921'});const library=await post('/api/collections',{name:'视觉参考'}),images=[];
  for(let index=0;index<3;index++){const buffer=await sharp({create:{width:600,height:800,channels:3,background:['#8a9ab9','#aa8eac','#a0aa78'][index]}}).png().toBuffer();const r=await context.request.post(base+'/api/assets',{multipart:{file:{name:'page.png',mimeType:'image/png',buffer},title:'页面 '+(index+1),collection_id:library.id,group_key:'pixiv:art:123',group_title:'三页参考',group_index:String(index)}});assert.ok(r.ok());images.push(await r.json());}
  const note=await post('/api/items',{title:'排版笔记',collection_id:library.id,content:'# 色彩观察\n\n[参考来源](https://example.com)\n\n'+images.map((i,n)=>`![配图 ${n+1}](${i.url})\n\n保留正文 ${n+1}`).join('\n\n')});
  await context.request.patch(base+'/api/preferences',{data:{default_collection_id:library.id}});
  await page.goto(base);await page.getByRole('button',{name:'打开 三页参考',exact:true}).click();await sort(image,'调整顺序');
  assert.equal((await orderIds(images[0].id))[0],images[2].id);
  await page.evaluate(()=>{document.documentElement.dataset.theme='dark';document.documentElement.dataset.style='minimal';document.documentElement.dataset.palette='slate';});await page.waitForTimeout(350);
  await page.screenshot({path:resolve('artifacts/v0921-sort-undo-desktop.png')});
  await page.setViewportSize({width:390,height:667});
  const undoButton=image.getByRole('button',{name:'撤销排序',exact:true});
  assert.ok(await undoButton.evaluate(el=>{const r=el.getBoundingClientRect();return r.bottom<=innerHeight&&el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}));
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:resolve('artifacts/v0921-sort-undo-mobile.png')});
  // Server succeeds but browser loses the response: retry the same undo receipt.
  await page.route('**/api/undo/*',async route=>{await route.fetch();await route.abort('failed');});
  await undoButton.click();await image.getByRole('alert').waitFor();assert.deepEqual(await orderIds(images[0].id),images.map(i=>i.id));
  const beforeRetry=runtime.db.prepare('SELECT id,version FROM items ORDER BY id').all();await page.unrouteAll();await undoButton.click();await undoButton.waitFor({state:'hidden'});assert.deepEqual(runtime.db.prepare('SELECT id,version FROM items ORDER BY id').all(),beforeRetry);
  await image.getByText('第 1 / 3 张',{exact:true}).waitFor();
  await page.setViewportSize({width:1366,height:768});await sort(image,'调整顺序');await page.keyboard.press('Escape');await page.reload();
  await page.getByRole('button',{name:'最近操作',exact:true}).click();const history=dialog('最近操作');await history.locator('.undo-row').filter({hasText:'整组排序'}).first().getByRole('button',{name:'撤销',exact:true}).click();assert.deepEqual(await orderIds(images[0].id),images.map(i=>i.id));await history.getByRole('button',{name:'关闭窗口',exact:true}).click();
  await page.getByRole('button',{name:'打开 排版笔记',exact:true}).click();await sort(noteDetail,'调整配图顺序');
  await noteDetail.getByRole('button',{name:'撤销排序',exact:true}).click();await noteDetail.getByRole('button',{name:'撤销排序',exact:true}).waitFor({state:'hidden'});assert.equal((await get('/api/items/'+note.id)).content,note.content);assert.equal(await noteDetail.locator('.markdown-preview a[href="https://example.com"]').count(),1);
  // Typing while the undo response is in flight remains a local draft.
  await sort(noteDetail,'调整配图顺序');await noteDetail.getByRole('button',{name:'编辑',exact:true}).click();let releaseUndo,seenUndo;const arrived=new Promise(r=>seenUndo=r),release=new Promise(r=>releaseUndo=r);
  await page.route('**/api/undo/*',async route=>{const response=await route.fetch();seenUndo();await release;await route.fulfill({response});});
  await noteDetail.getByRole('button',{name:'撤销排序',exact:true}).click();await arrived;
  const editor=noteDetail.locator('.markdown-editor'),typed=await editor.inputValue()+'\n\n撤销期间继续输入';await editor.fill(typed);releaseUndo();await noteDetail.getByRole('button',{name:'撤销排序',exact:true}).waitFor({state:'hidden'});assert.equal(await editor.inputValue(),typed);assert.equal((await get('/api/items/'+note.id)).content,note.content);
  await page.unrouteAll();const savedResponse=page.waitForResponse(r=>r.url()===base+'/api/items/'+note.id&&r.request().method()==='PATCH');await noteDetail.getByRole('button',{name:'保存',exact:true}).click();assert.equal((await savedResponse).status(),200);await page.waitForFunction(()=>!document.querySelector('.detail-bottom .primary')?.disabled);assert.equal((await get('/api/items/'+note.id)).content,typed);await page.keyboard.press('Escape');await noteDetail.waitFor({state:'hidden'});
  // New group members cause an atomic, visible conflict.
  await page.getByRole('button',{name:'打开 三页参考',exact:true}).click();await sort(image,'调整顺序');
  const original=await get('/api/items/'+images[1].id);await post('/api/items/batch-trash',{items:[{id:original.id,version:original.version}],collection_id:library.id});const beforeConflict=runtime.db.prepare('SELECT * FROM items ORDER BY id').all();
  await image.getByRole('button',{name:'撤销排序',exact:true}).click();await image.getByRole('alert').filter({hasText:'图片组成员已变化'}).waitFor();assert.deepEqual(runtime.db.prepare('SELECT * FROM items ORDER BY id').all(),beforeConflict);
  assert.deepEqual(errors,[]);console.log('PASS Edge: inline sort undo, cover/strip refresh, mobile hit targets, history after reload, note links and order, lost response retry, in-flight typing, conflict atomicity');
}finally{await page.unrouteAll({behavior:'ignoreErrors'});await browser.close();await runtime.trash.stop();await runtime.imports.stop();await runtime.backups.stop();await runtime.webhooks.stop();await new Promise(r=>server.close(r));runtime.db.close();}
