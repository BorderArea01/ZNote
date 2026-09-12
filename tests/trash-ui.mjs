import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {resolve} from 'node:path';
import sharp from 'sharp';
import {createApp} from '../server/app.js';
const dir=await mkdtemp(resolve('artifacts/trash-ui-')),runtime=createApp({dataDir:dir,staticDir:resolve('artifacts/build-v098')}),server=runtime.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({channel:'msedge',headless:true}),context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
const post=async(path,data)=>{const r=await context.request.post(base+path,{data});assert.ok(r.ok(),await r.text());return r.json()};
try{
 await post('/api/auth/setup',{password:'0988'});const a=await post('/api/collections',{name:'设计素材'}),b=await post('/api/collections',{name:'其他知识库'});
 const buffer=await sharp({create:{width:800,height:600,channels:3,background:'#778cae'}}).png().toBuffer();const r=await context.request.post(base+'/api/assets',{multipart:{file:{name:'fixture.png',mimeType:'image/png',buffer},title:'已删除的封面',collection_id:a.id}});assert.ok(r.ok());const image=await r.json();
 const note=await post('/api/items',{title:'保留配图的笔记',collection_id:a.id,content:`![配图](${image.url})`});await context.request.delete(base+'/api/items/'+image.id);
 for(let i=1;i<=3;i++){const n=await post('/api/items',{title:'待删除 '+i,collection_id:a.id});await context.request.delete(base+'/api/items/'+n.id)}
 const other=await post('/api/items',{title:'其他库的回收站',collection_id:b.id});await context.request.delete(base+'/api/items/'+other.id);
 await context.request.patch(base+'/api/preferences',{data:{default_collection_id:a.id}});await page.goto(base);await page.getByRole('button',{name:'回收站',exact:false}).first().click();await page.getByRole('button',{name:'永久删除 已删除的封面',exact:true}).click();let dialog=page.getByRole('dialog',{name:'永久删除',exact:true});await dialog.getByText('永久删除 1 项内容',{exact:true}).waitFor();await dialog.getByRole('button',{name:'取消',exact:true}).click();assert.ok((await context.request.get(base+'/api/items/'+image.id)).ok());
 await page.getByRole('button',{name:'永久删除 已删除的封面',exact:true}).click();await dialog.getByRole('button',{name:'永久删除',exact:true}).click();await dialog.waitFor({state:'hidden'});assert.equal((await context.request.get(base+'/api/items/'+image.id)).status(),404);
 await page.getByRole('button',{name:'选择内容',exact:true}).click();await page.getByRole('button',{name:'选择 待删除 1',exact:true}).click();await page.getByRole('button',{name:'选择 待删除 2',exact:true}).click();await page.getByRole('button',{name:'永久删除所选',exact:true}).click();await dialog.getByText('永久删除 2 项内容',{exact:true}).waitFor();await dialog.getByRole('button',{name:'永久删除',exact:true}).click();await dialog.waitFor({state:'hidden'});await page.getByRole('button',{name:'退出选择',exact:true}).click();
 // Search hides the last item, but emptying must still include it.
 await page.getByRole('textbox',{name:'搜索内容',exact:true}).fill('不存在的搜索');await page.waitForTimeout(400);await page.getByRole('button',{name:'清空回收站',exact:true}).click();dialog=page.getByRole('dialog',{name:'清空回收站',exact:true});await dialog.getByText('永久删除 1 项内容',{exact:true}).waitFor();
 await page.evaluate(()=>{document.documentElement.dataset.theme='dark';document.documentElement.dataset.palette='slate'});await page.waitForTimeout(300);await page.screenshot({path:resolve('artifacts/v098-trash-desktop.png')});await page.setViewportSize({width:390,height:844});await page.screenshot({path:resolve('artifacts/v098-trash-mobile.png')});assert.ok(await dialog.getByRole('button',{name:'确认清空',exact:true}).isVisible());await dialog.getByRole('button',{name:'确认清空',exact:true}).click();await dialog.waitFor({state:'hidden'});
 assert.equal((await post('/api/trash/preview',{collection_id:a.id})).count,0);assert.equal((await post('/api/trash/preview',{collection_id:b.id})).count,1);const current=await (await context.request.get(base+'/api/items/'+note.id)).json();assert.ok(!current.content.includes(image.id));
 assert.deepEqual(errors,[]);console.log('PASS Edge: cancel/single/selected/all deletion, filtered scope, retained note attachments, other library untouched, dark desktop/mobile');
}finally{await browser.close();await runtime.trash.stop();await runtime.imports.stop();await runtime.backups.stop();await runtime.webhooks.stop();await new Promise(r=>server.close(r));runtime.db.close()}

