import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {createApp} from '../server/app.js';
const dir=await mkdtemp(resolve('artifacts/mobile-history-')),runtime=createApp({dataDir:dir,staticDir:resolve('dist')}),server=runtime.app.listen(0,'127.0.0.1');
await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({channel:'msedge',headless:true}),context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
const post=async(path,data)=>{const r=await context.request.post(base+path,{data});assert.ok(r.ok(),await r.text());return r.json();};
try{
 await post('/api/auth/setup',{password:'0953'});const lib=await post('/api/collections',{name:'独立知识库'});
 await context.request.patch(base+'/api/preferences',{data:{default_collection_id:lib.id}});
 const buffer=await sharp({create:{width:180,height:120,channels:3,background:'#7189c7'}}).png().toBuffer();
 for(const [id,title] of [[lib.id,'别库的图片'],[null,'未分类的图片']]){
  const response=await context.request.post(base+'/api/assets',{multipart:{file:{name:title+'.png',mimeType:'image/png',buffer},title,collection_id:id||''}});assert.ok(response.ok());const item=await response.json();
  const state=await(await context.request.get(base+'/api/reading-progress?collection='+(id||'unfiled'))).json();
  await post('/api/reading-progress',{collection_id:id,item_id:item.id,epoch:state.epoch,version:state.version,request_id:randomUUID()});
 }
 await page.goto(base);await page.locator('.reading-resume-main').getByText('别库的图片',{exact:true}).waitFor();
 for(let i=0;i<2;i++){
  await page.getByRole('button',{name:'打开导航',exact:true}).tap();await page.locator('.collections-nav').getByRole('button',{name:/^未分类/}).tap();
  await page.locator('.reading-resume-main').getByText('未分类的图片',{exact:true}).waitFor();assert.equal(await page.locator('.reading-resume-main').getByText('别库的图片',{exact:true}).count(),0);
  await page.getByRole('button',{name:'浏览记录',exact:true}).tap();const dialog=page.getByRole('dialog',{name:'浏览记录',exact:true});await dialog.locator('.reading-history-row').getByText('未分类的图片',{exact:true}).waitFor();assert.equal(await dialog.getByText('别库的图片',{exact:true}).count(),0);await dialog.getByRole('button',{name:'完成',exact:true}).tap();
  await page.getByRole('button',{name:'打开导航',exact:true}).tap();await page.locator('.collections-nav').getByRole('button',{name:/^独立知识库 /}).tap();await page.locator('.reading-resume-main').getByText('别库的图片',{exact:true}).waitFor();
 }
 const refresh=page.getByRole('button',{name:'刷新内容',exact:true});await refresh.waitFor();const rect=await refresh.boundingBox();assert.ok(rect.x>=0&&rect.x+rect.width<=390&&rect.y<100,'refresh is visible in mobile top bar');
 await post('/api/items',{title:'刷新后出现',collection_id:lib.id,content:'新笔记'});await refresh.tap();await page.getByRole('button',{name:'打开 刷新后出现',exact:true}).waitFor();
 await page.getByRole('searchbox').count();await page.getByRole('textbox',{name:'搜索内容',exact:true}).fill('刷新后出现');await page.waitForTimeout(500);await refresh.tap();assert.equal(await page.getByRole('textbox',{name:'搜索内容',exact:true}).inputValue(),'刷新后出现');
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'artifacts/mobile-refresh-history.png'});
 await page.setViewportSize({width:1366,height:768});await refresh.click();await page.getByRole('button',{name:'打开 刷新后出现',exact:true}).waitFor();assert.deepEqual(errors,[]);
 console.log('PASS touch unfiled/library history isolation, repeated switching, visible refresh, newly saved content and filter preservation; desktop refresh');
}finally{await browser.close();for(const key of ['captures','weixin','trash','imports','backups','webhooks'])await runtime[key].stop();await new Promise(r=>server.close(r));runtime.db.close();}
