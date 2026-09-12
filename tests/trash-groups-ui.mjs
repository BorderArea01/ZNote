import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {resolve} from 'node:path';
import sharp from 'sharp';
import {createApp} from '../server/app.js';
const dir=await mkdtemp(resolve('artifacts/trash-group-ui-')),runtime=createApp({dataDir:dir,staticDir:resolve(process.env.UI_DIST||'dist')}),server=runtime.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({channel:'msedge',headless:true}),context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
const post=async(path,data)=>{const r=await context.request.post(base+path,{data});assert.ok(r.ok(),await r.text());return r.json()};
try{
 await post('/api/auth/setup',{password:'0999'});const collection=await post('/api/collections',{name:'画册测试'}),pages=[];
 for(let i=0;i<3;i++){const buffer=await sharp({create:{width:900,height:600,channels:3,background:['#788cb0','#aa8978','#78aa98'][i]}}).png().toBuffer();const r=await context.request.post(base+'/api/assets',{multipart:{file:{name:'test.png',mimeType:'image/png',buffer},title:'分镜 '+i,collection_id:collection.id}});assert.ok(r.ok());pages.push(await r.json())}
 const note=await post('/api/items',{title:'三页画册',collection_id:collection.id,content:pages.map(p=>`![页](${p.url})`).join('\n\n')});let state=await (await context.request.get(base+'/api/item-groups/order?id='+note.id)).json();await post('/api/item-groups/order',{id:note.id,revision:state.revision,ids:state.items.map(p=>p.id).reverse(),sync_note:false});
 for(const p of pages)await context.request.delete(base+'/api/items/'+p.id);await context.request.delete(base+'/api/items/'+note.id);
 const before=await (await context.request.get(base+'/api/items?collection='+collection.id+'&kind=image&grouped=true')).json();assert.equal(before.total,1);const cover=before.items[0].id;
 await context.request.patch(base+'/api/preferences',{data:{default_collection_id:collection.id}});await page.goto(base);await page.getByRole('button',{name:'回收站',exact:false}).first().click();await page.getByRole('button',{name:'清空回收站',exact:true}).click();const dialog=page.getByRole('dialog',{name:'清空回收站',exact:true});await dialog.getByText('永久删除 4 项内容',{exact:true}).waitFor();await dialog.getByRole('button',{name:'确认清空',exact:true}).click();await dialog.waitFor({state:'hidden'});
 await page.getByRole('button',{name:'图片素材',exact:false}).first().click();const card=page.getByRole('button',{name:'打开 三页画册 · 配图',exact:true});await card.waitFor();assert.equal(await page.locator('.item-card').count(),1);assert.ok((await card.locator('img').getAttribute('src')).includes(cover));await card.click();const detail=page.getByRole('dialog',{name:'图片详情',exact:true});await detail.waitFor();await detail.locator('.gallery-strip button').nth(2).waitFor();assert.equal(await detail.locator('.gallery-strip button').count(),3);await detail.locator('.gallery-strip button').nth(1).click();await page.keyboard.press('ArrowRight');
 await page.evaluate(()=>{document.documentElement.dataset.theme='dark';document.documentElement.dataset.palette='slate'});await page.waitForTimeout(300);await page.screenshot({path:resolve('artifacts/v099-retained-group.png')});assert.deepEqual(errors,[]);console.log('PASS Edge: clearing note and trashed originals preserves one album, three thumbnails, original cover and keyboard navigation');
}finally{await browser.close();await runtime.trash.stop();await runtime.imports.stop();await runtime.backups.stop();await runtime.webhooks.stop();await new Promise(r=>server.close(r));runtime.db.close()}
