import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {resolve} from 'node:path';
import sharp from 'sharp';
import {createApp} from '../server/app.js';
const dir=await mkdtemp(resolve('artifacts/sort-gallery-ui-')),runtime=createApp({dataDir:dir,staticDir:resolve(process.env.UI_DIST||'dist')}),server=runtime.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({channel:'msedge',headless:true}),context=await browser.newContext({viewport:{width:1366,height:768}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
const post=async(path,data)=>{const r=await context.request.post(base+path,{data});assert.ok(r.ok(),await r.text());return r.json()};
try{
 await post('/api/auth/setup',{password:'0952'});const library=await post('/api/collections',{name:'排序与翻页'});
 const image=async(title,group,index)=>{const buffer=await sharp({create:{width:500,height:340,channels:3,background:{r:80+title.charCodeAt(0)%120,g:90+(index||0)*50,b:150}}}).png().toBuffer(),multipart={collection_id:library.id,title,file:{name:title+'.png',mimeType:'image/png',buffer}};if(group){multipart.group_key=group;multipart.group_title='C 图组';multipart.group_index=String(index)}const r=await context.request.post(base+'/api/assets',{multipart});assert.ok(r.ok(),await r.text());return r.json()};
 const singleA=await image('A 单图'),singleB=await image('B 单图'),groupA=await image('C 组内一','test:group',0);await image('C 组内二','test:group',1);for(let i=0;i<35;i++)await post('/api/items',{title:'D 笔记 '+String(i).padStart(2,'0'),content:'用于形成可滚动的背景',collection_id:library.id});
 await context.request.patch(base+'/api/preferences',{data:{default_collection_id:library.id}});await page.goto(base);await page.waitForFunction(()=>!document.querySelector('.loading-state'));
 await page.getByLabel('排序方式').selectOption('title');await page.getByLabel('排序方向').selectOption('desc');await page.getByLabel('内容排列').selectOption('grouped');await page.waitForTimeout(300);await page.waitForFunction(id=>document.querySelector('.item-card')?.dataset.itemId===id,singleB.id);
 await page.getByLabel('排序方向').selectOption('asc');await page.waitForTimeout(300);await page.waitForFunction(id=>document.querySelector('.item-card')?.dataset.itemId===id,singleA.id);
 await page.locator(`[data-item-id="${singleA.id}"] .card-main`).click();const detail=page.getByRole('dialog',{name:'图片详情',exact:true});await detail.locator('.gallery-strip button').first().waitFor();assert.equal(await detail.locator('.gallery-strip button').count(),2);assert.equal(await detail.locator(`.gallery-strip img[src*="${groupA.id}"]`).count(),0);
 await detail.getByText('第 1 / 2 张',{exact:true}).waitFor();await page.keyboard.press('d');await page.waitForFunction(()=>document.querySelector('#item-title')?.value==='B 单图');const before=await page.evaluate(()=>scrollY);await detail.getByRole('button',{name:'全屏查看图片',exact:true}).hover();for(let i=0;i<18;i++)await page.mouse.wheel(0,180);await page.waitForTimeout(250);assert.equal(await page.evaluate(()=>scrollY),before,'rapid preview paging must not scroll the background gallery');
 await detail.getByRole('button',{name:'关闭窗口',exact:true}).click();await page.mouse.wheel(0,600);await page.waitForTimeout(100);assert.ok(await page.evaluate(()=>scrollY)>before,'background scrolling must resume after closing the preview');
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);console.log('PASS Edge: sort field/direction/type sections, single-only paging, rapid wheel background lock and mobile toolbar bounds');
}finally{await browser.close();await runtime.trash.stop();await runtime.imports.stop();await runtime.backups.stop();await runtime.webhooks.stop();await new Promise(r=>server.close(r));runtime.db.close()}
