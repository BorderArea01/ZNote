import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {resolve} from 'node:path';
import sharp from 'sharp';
import {createApp} from '../server/app.js';
const dir=await mkdtemp(resolve('artifacts/help-gallery-')),runtime=createApp({dataDir:dir,staticDir:resolve(process.env.UI_DIST||'dist')}),server=runtime.app.listen(0,'127.0.0.1');
await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({channel:'msedge',headless:true}),context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
const post=async(path,data)=>{const r=await context.request.post(base+path,{data});assert.ok(r.ok(),await r.text());return r.json();};
const zoom=()=>page.getByRole('dialog',{name:'展开图片',exact:true});
try{
 await post('/api/auth/setup',{password:'0934'});const library=await post('/api/collections',{name:'翻图验收'}),other=await post('/api/collections',{name:'不应进入的知识库'}),images=[];
 for(let i=0;i<6;i++){const buffer=await sharp({create:{width:1000,height:700,channels:3,background:['#a36272','#567a93','#6e8860'][i%3]}}).png().toBuffer();const r=await context.request.post(base+'/api/assets',{multipart:{file:{name:'test.png',mimeType:'image/png',buffer},title:'测试图 '+i,collection_id:library.id,...(i<3?{group_key:'test:gallery',group_title:'翻图测试',group_index:String(i)}:{})}});assert.ok(r.ok());images.push(await r.json());}
 await post('/api/items',{title:'配图笔记',collection_id:library.id,content:images.slice(3).map(i=>`![笔记配图](${i.url})`).join('\n\n')});
 await post('/api/items',{title:'库外内容',collection_id:other.id,content:'不得出现在翻图中'});
 await context.request.patch(base+'/api/preferences',{data:{default_collection_id:library.id}});await page.goto(base);
 await page.getByRole('button',{name:'打开导航',exact:true}).click();await page.getByRole('button',{name:'设置与连接',exact:true}).click();const settings=page.getByRole('dialog',{name:'设置与连接',exact:true});
 const help=page.getByRole('button',{name:'浏览器采集说明',exact:true});await help.tap();await page.getByRole('tooltip').waitFor();await page.waitForTimeout(450);assert.equal(await help.getAttribute('aria-expanded'),'true','touch-up must not dismiss hint');await help.tap();await page.getByRole('tooltip').waitFor({state:'hidden'});
 await page.getByRole('button',{name:'微信通知说明',exact:true}).tap();await page.waitForTimeout(300);assert.equal(await page.getByRole('tooltip').count(),1);await page.keyboard.press('Escape');assert.equal(await page.getByRole('tooltip').count(),0);assert.equal(await settings.count(),1);
 await page.setViewportSize({width:320,height:400});await page.getByRole('button',{name:'通知接入与发送结果说明',exact:true}).tap();await page.getByRole('tooltip').waitFor();
 await page.getByRole('tooltip').evaluate(el=>{el.scrollTop=el.scrollHeight});await page.waitForTimeout(200);assert.equal(await page.getByRole('tooltip').count(),1);
 assert.ok(await page.getByRole('tooltip').evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight}));
 await page.screenshot({path:resolve('artifacts/help-touch-small.png')});await page.evaluate(()=>window.ZNoteNavigation.back());await page.getByRole('tooltip').waitFor({state:'hidden'});assert.equal(await settings.count(),1);
 await page.setViewportSize({width:1366,height:768});await help.hover();await page.getByRole('tooltip').waitFor();await page.mouse.move(2,2);await page.getByRole('tooltip').waitFor({state:'hidden'});
 await help.focus();await help.press('Enter');await page.waitForTimeout(200);assert.equal(await help.getAttribute('aria-expanded'),'true');await page.keyboard.press('Escape');
 await settings.getByRole('button',{name:'关闭窗口',exact:true}).click();
 await page.getByRole('button',{name:'打开 翻图测试',exact:true}).click();await page.getByRole('button',{name:'全屏查看图片',exact:true}).click();
 const expectImage=async id=>page.waitForFunction(id=>document.querySelector('.zoom-surface img')?.getAttribute('src')?.includes(id),id);
 await expectImage(images[0].id);await page.keyboard.press('d');await expectImage(images[1].id);assert.equal(await zoom().count(),1);await page.keyboard.press('ArrowLeft');await expectImage(images[0].id);
 await zoom().getByRole('button',{name:'放大',exact:true}).click();await page.keyboard.press('ArrowRight');await expectImage(images[1].id);assert.equal(await zoom().getByLabel('缩放比例',{exact:true}).innerText(),'100%');
 await zoom().getByRole('button',{name:'下一张图片',exact:true}).click();await expectImage(images[2].id);assert.equal(await zoom().getByRole('button',{name:'下一张图片',exact:true}).isDisabled(),true);await page.keyboard.press('d');await expectImage(images[2].id);await page.keyboard.press('a');await expectImage(images[1].id);
 await page.setViewportSize({width:390,height:844});await zoom().locator('img').evaluate(img=>img.decode());const cdp=await context.newCDPSession(page);
 const touch=(type,points)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points.map(([id,x,y])=>({id,x,y,radiusX:2,radiusY:2,force:1}))});
 const swipe=async(from,to)=>{await touch('touchStart',[[1,from,410]]);for(let i=1;i<=5;i++)await touch('touchMove',[[1,from+(to-from)*i/5,412]]);await touch('touchEnd',[]);};
 await swipe(310,80);await expectImage(images[2].id);await swipe(80,310);await expectImage(images[1].id);
 await touch('touchStart',[[1,145,410],[2,245,410]]);await touch('touchMove',[[1,70,410],[2,320,410]]);await touch('touchEnd',[]);await page.waitForFunction(()=>parseInt(document.querySelector('.zoom-tools output')?.textContent)>200);await expectImage(images[1].id);
 await swipe(270,140);await expectImage(images[1].id); // Pan from centre, not a page turn.
 await swipe(330,40);await expectImage(images[1].id); // Reach the image edge first.
 await swipe(310,80);await expectImage(images[2].id); // Continuing outwards turns the page.
 await swipe(80,310);await expectImage(images[1].id);
 await zoom().getByRole('button',{name:'重置缩放',exact:true}).click();await zoom().getByRole('button',{name:'大图操作说明',exact:true}).tap();await page.waitForTimeout(400);assert.equal(await page.getByRole('tooltip').count(),1);await page.keyboard.press('Escape');assert.equal(await zoom().count(),1);assert.equal(await page.getByRole('tooltip').count(),0);
 await page.screenshot({path:resolve('artifacts/zoom-gallery-mobile.png')});await page.keyboard.press('Escape');assert.equal(await zoom().count(),0);await page.getByRole('dialog',{name:'图片详情',exact:true}).getByRole('button',{name:'关闭窗口',exact:true}).click();
 await page.getByRole('button',{name:'打开 翻图测试',exact:true}).click();assert.equal(await zoom().count(),0,'Opening a new detail must not inherit expanded mode');await page.getByRole('dialog',{name:'图片详情',exact:true}).getByRole('button',{name:'关闭窗口',exact:true}).click();
 await page.getByRole('button',{name:'打开 配图笔记',exact:true}).click();await page.locator('.markdown-preview img').first().waitFor();const noteIds=await page.locator('.markdown-preview img').evaluateAll(imgs=>imgs.map(i=>i.getAttribute('src').match(/media\/([^/]+)/)[1]));assert.equal(noteIds.length,3);await page.locator('.markdown-preview img').first().click();await page.getByRole('button',{name:'展开笔记配图',exact:true}).click();await expectImage(noteIds[0]);await page.keyboard.press('d');await expectImage(noteIds[1]);await swipe(310,80);await expectImage(noteIds[2]);assert.equal(await zoom().getByRole('button',{name:'下一张图片',exact:true}).isDisabled(),true);await page.keyboard.press('Escape');await page.getByRole('dialog',{name:'笔记配图',exact:true}).getByText('第 3 / 3 张',{exact:true}).waitFor();assert.deepEqual(errors,[]);
 console.log('PASS touch/mouse/keyboard hints; expanded gallery keyboard/buttons/swipe and bounds; pinch/pan; Escape layers; note gallery ordering and library scope');
}catch(e){await page.screenshot({path:resolve('artifacts/help-gallery-failure.png')});throw e;}finally{await browser.close();await runtime.weixin.stop();await runtime.trash.stop();await runtime.backups.stop();await runtime.webhooks.stop();await runtime.imports.stop();await new Promise(r=>server.close(r));runtime.db.close();}
