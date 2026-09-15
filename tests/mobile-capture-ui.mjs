import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {resolve} from 'node:path';
import sharp from 'sharp';
import {createApp} from '../server/app.js';
const dir=await mkdtemp(resolve('artifacts/mobile-capture-ui-')),png=await sharp({create:{width:300,height:180,channels:3,background:'#7084ab'}}).png().toBuffer();
const runtime=createApp({dataDir:dir,staticDir:resolve('dist'),captureOptions:{page:async()=>({url:'https://example.com/article',type:'text/html',buffer:Buffer.from('<html><head><title>手机分享验收</title><meta name="author" content="示例作者"></head><body><article><h1>手机分享验收</h1><p>第一行<br>第二行 <a href="/source">原始资料</a></p><img src="https://example.com/image.png"><p>'+('用来验证图文采集与本地配图。'.repeat(30))+'</p></article></body></html>')}),image:async()=>png}}),server=runtime.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const base='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({channel:'msedge',headless:true}),context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
const post=async(path,data)=>{const r=await context.request.post(base+path,{data});assert.ok(r.ok(),await r.text());return r.json();};
try{
 await post('/api/auth/setup',{password:'0953'});const library=await post('/api/collections',{name:'手机采集验收'});await page.goto(base);await page.getByRole('heading',{name:library.name,exact:true}).tap();
 const buttons=page.getByRole('button',{name:'网络采集',exact:true});if(!await buttons.isVisible())await page.getByRole('button',{name:'更多操作',exact:true}).tap();await buttons.tap();
 const dialog=page.getByRole('dialog',{name:'网络采集',exact:true});await dialog.getByLabel('分享内容').fill('从手机分享 https://example.com/article');await dialog.locator('.capture-panel select').selectOption(library.id);
 await dialog.getByRole('button',{name:'手机与网页采集说明',exact:true}).tap();await page.waitForTimeout(100);assert.ok(await page.getByText('粘贴 App 分享文字或网页链接，由服务器保存正文、配图或视频。',{exact:false}).isVisible());await dialog.getByRole('button',{name:'手机与网页采集说明',exact:true}).tap();
 await dialog.getByRole('button',{name:'采集到知识库',exact:true}).tap();await dialog.getByRole('button',{name:'查看内容',exact:true}).waitFor({timeout:15000});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'artifacts/mobile-capture-ui.png'});
 const jobs=await (await context.request.get(base+'/api/captures')).json();const id=jobs.jobs[0].item_id;
 await dialog.getByRole('button',{name:'关闭窗口',exact:true}).tap();await page.goto(base+'/?item='+id);await page.getByRole('dialog').waitFor();assert.ok((await page.locator('#item-title').inputValue()).includes('手机分享验收'));
 const item=await(await context.request.get(base+'/api/items/'+id)).json();assert.ok(item.tags.includes('示例作者'));assert.match(item.content,/\/media\//);assert.equal(item.source_url,'https://example.com/article');assert.deepEqual(errors,[]);
 await page.setViewportSize({width:1366,height:768});await page.screenshot({path:'artifacts/mobile-capture-note-desktop.png'});console.log('PASS touch capture, local images, author/source, note deep link and viewport bounds');
}finally{await browser.close();await runtime.captures.stop();await runtime.weixin.stop();await runtime.trash.stop();await runtime.imports.stop();await runtime.backups.stop();await runtime.webhooks.stop();await new Promise(r=>server.close(r));runtime.db.close();}
