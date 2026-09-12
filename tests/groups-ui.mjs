import {chromium} from 'playwright';
import {mkdtemp} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {createApp} from '../server/app.js';
const dir=await mkdtemp(resolve('artifacts/groups-ui-')),runtime=createApp({dataDir:dir,staticDir:resolve(process.env.UI_DIST||'dist')}),server=runtime.app.listen(0,'127.0.0.1');
await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({channel:'msedge',headless:true}),context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
const post=async(path,data)=>{const r=await context.request.post(base+path,{data});assert.ok(r.ok(),await r.text());return r.json()};
try{
 await post('/api/auth/setup',{password:'0922'});const a=await post('/api/collections',{name:'漫画馆'}),b=await post('/api/collections',{name:'摄影馆'});
 for(const collection of [a,b])for(const index of [2,0,1]){const buffer=await sharp({create:{width:800,height:600,channels:3,background:['#9295c6','#cba88b','#7996a6'][index]}}).png().toBuffer();const r=await context.request.post(base+'/api/assets',{multipart:{file:{name:'page.png',mimeType:'image/png',buffer},collection_id:collection.id,title:'分镜 '+(index+1),group_key:'pixiv:art:12345',group_index:String(index),group_title:collection.name+'作品',source_url:'https://www.pixiv.net/artworks/12345',tags:JSON.stringify(['测试作者'])}});assert.ok(r.ok(),await r.text());}
 await context.request.patch(base+'/api/preferences',{data:{default_collection_id:a.id}});await page.goto(base);
 await page.getByRole('button',{name:'打开 漫画馆作品',exact:true}).waitFor();assert.equal(await page.locator('.card-main').count(),1);assert.ok((await page.locator('.kind-chip').innerText()).includes('3 张'));
 await page.getByRole('button',{name:'打开 漫画馆作品',exact:true}).click();await page.getByText('第 1 / 3 张',{exact:true}).waitFor();
 await page.getByRole('button',{name:'下一张 →',exact:true}).click();await page.getByText('第 2 / 3 张',{exact:true}).waitFor();await page.getByRole('button',{name:'下一张 →',exact:true}).click();await page.getByText('第 3 / 3 张',{exact:true}).waitFor();
 await page.getByRole('button',{name:'关闭窗口',exact:true}).click();await page.getByRole('button',{name:'选择内容',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.card-main').length===3);await page.getByRole('button',{name:'退出选择',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.card-main').length===1);
 await page.locator('.collections-nav').getByRole('button',{name:/^摄影馆 /}).click();await page.getByRole('button',{name:'打开 摄影馆作品',exact:true}).waitFor();assert.equal(await page.locator('.card-main').count(),1);
 await page.screenshot({path:resolve('artifacts/groups-desktop.png')});await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:resolve('artifacts/groups-mobile.png')});assert.deepEqual(errors,[]);console.log('PASS grouped cover, page order, individual selection, library isolation and mobile');
}finally{await browser.close();await runtime.imports.stop();await runtime.backups.stop();await runtime.webhooks.stop();await new Promise(r=>server.close(r));runtime.db.close()}
