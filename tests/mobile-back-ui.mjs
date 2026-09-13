import {chromium} from 'playwright';
import {mkdtemp} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {createApp} from '../server/app.js';
const dir=await mkdtemp(resolve('artifacts/mobile-back-')),runtime=createApp({dataDir:dir,staticDir:resolve(process.env.UI_DIST||'dist')}),server=runtime.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const base='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({channel:'msedge',headless:true}),context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();
const post=async(path,data)=>{const r=await context.request.post(base+path,{data});assert.ok(r.ok(),await r.text());return r.json()};
const back=()=>page.evaluate(()=>window.ZNoteNavigation.back());
try{
 await post('/api/auth/setup',{password:'0427'});const lib=await post('/api/collections',{name:'移动端验收'});
 const buffer=await sharp({create:{width:640,height:460,channels:3,background:'#887ab8'}}).png().toBuffer();
 const r=await context.request.post(base+'/api/assets',{multipart:{collection_id:lib.id,title:'返回测试图',file:{name:'image.png',mimeType:'image/png',buffer}}});assert.ok(r.ok());
 await post('/api/items',{title:'待编辑笔记',content:'原内容',collection_id:lib.id});
 await page.goto(base);await page.getByRole('button',{name:/移动端验收/}).last().click();
 await page.getByRole('button',{name:'打开 返回测试图',exact:true}).click();await page.getByRole('button',{name:'全屏查看图片',exact:true}).click();await page.locator('.zoom-viewer').waitFor();
 assert.equal(await back(),true);await page.locator('.zoom-viewer').waitFor({state:'hidden'});assert.equal(await page.locator('.detail-dialog').count(),1);
 await back();await page.locator('.detail-dialog').waitFor({state:'hidden'});assert.ok(await page.locator('.item-card').count());
 await page.getByRole('button',{name:'打开 待编辑笔记',exact:true}).click();await page.getByRole('button',{name:'编辑',exact:true}).click();await page.locator('.markdown-editor').fill('修改内容\n尚未关闭');
 await back();await page.locator('.detail-dialog').waitFor({state:'hidden'}); // Existing local-draft protection remains active.
 // Note drafts may use IndexedDB; reopen through the app to verify recovery.
 await page.getByRole('button',{name:'打开 待编辑笔记',exact:true}).click();await page.getByRole('button',{name:'编辑',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.markdown-editor')?.value.includes('修改内容'));
 await back();await page.locator('.detail-dialog').waitFor({state:'hidden'});
 await page.getByRole('button',{name:'在当前位置多选',exact:true}).count();
 await page.getByRole('button',{name:'选择内容',exact:true}).click();await page.locator('.batch-toolbar').waitFor();await back();await page.locator('.batch-toolbar').waitFor({state:'hidden'});
 await page.getByRole('button',{name:'打开导航',exact:true}).click();await page.locator('.sidebar.mobile-open').waitFor();await back();await page.locator('.sidebar.mobile-open').waitFor({state:'hidden'});
 await back();await page.locator('.library-card').first().waitFor();assert.equal(await back(),false);
 console.log('PASS: native bridge pops zoom/detail, preserves draft, exits selection/drawer and returns to libraries before yielding root back');
}finally{await browser.close();await runtime.weixin.stop();await runtime.trash.stop();await runtime.imports.stop();await runtime.backups.stop();await runtime.webhooks.stop();await new Promise(r=>server.close(r));runtime.db.close()}
