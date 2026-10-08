import {chromium} from 'playwright';
import {mkdtemp} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {createApp} from '../server/app.js';

const dir=await mkdtemp(resolve('artifacts/page-tools-unified-')),extension=resolve('addons/browser/clipper');
const source='https://gallery.example/article/one',png=await sharp({create:{width:160,height:120,channels:3,background:'#123456'}}).png().toBuffer();
const runtime=createApp({dataDir:join(dir,'data'),captureOptions:{page:async url=>{
  await new Promise(r=>setTimeout(r,1100));
  return {plan:{kind:'note',url,title:'网站图集',content:'当前作品正文',images:['https://cdn.example/one.png','https://cdn.example/two.png']}};
},image:async()=>{await new Promise(r=>setTimeout(r,1100));return png;}}});
const server=runtime.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
let context;
try{
 for(const touch of [false,true]){
  context=await chromium.launchPersistentContext(join(dir,touch?'touch':'desktop'),{channel:'msedge',headless:true,hasTouch:touch,viewport:{width:touch?390:1100,height:840},args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  await context.request.post(base+(touch?'/api/auth/login':'/api/auth/setup'),{data:{password:'0123'}});
  const token=await (await context.request.post(base+'/api/tokens',{data:{name:'unified-tools',scope:'write'}})).json(),collection=await(await context.request.post(base+'/api/collections',{data:{name:touch?'触屏验收':'桌面验收'}})).json();
  await worker.evaluate(config=>chrome.storage.local.set(config),{server:base,token:token.token});
  await context.route('https://gallery.example/**',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:'<!doctype html><html style="background:#123456"><body style="margin:0;height:100vh;background:#123456;color:white"><main style="padding:30px">继续浏览 · 普通网站作品</main></body></html>'}));
  const page=await context.newPage();await page.goto(source);const tools=page.locator('[data-znote-page-tools]'),click=locator=>touch?locator.tap():locator.click(),more=tools.getByRole('button',{name:'更多采集方式'});
  await tools.getByRole('button',{name:'采集当前作品',exact:true}).waitFor();await click(more);
  await tools.getByRole('combobox',{name:'目标知识库'}).selectOption(collection.id);await page.waitForFunction(id=>{const s=document.querySelector('[data-znote-page-tools]')?.shadowRoot.querySelector('select');return s&&!s.disabled&&s.value===id;},collection.id);assert.equal((await worker.evaluate(()=>chrome.storage.local.get('collection_id'))).collection_id,collection.id);
  for(const label of ['框选截图','可见页面截图','保存页面正文','解析作品视频','前往知识库','扩展设置'])await tools.getByRole('button',{name:label,exact:true}).waitFor();
  const hint=tools.getByRole('button',{name:'页面采集说明'});await click(hint);await page.waitForTimeout(180);assert.equal(await hint.getAttribute('aria-expanded'),'true');await page.screenshot({path:join(dir,`menu-${touch?'touch':'desktop'}.png`)});
  await page.keyboard.press('Escape');assert.equal(await more.getAttribute('aria-expanded'),'false');
  await tools.getByRole('button',{name:'采集当前作品',exact:true}).evaluate(button=>button.click());await page.waitForTimeout(150);assert.equal((await worker.evaluate(()=>chrome.storage.local.get('lastCapture'))).lastCapture,undefined,'website synthetic clicks cannot start collection');
  const drag=tools.getByRole('button',{name:'拖动采集工具栏'}),before=await tools.boundingBox();
  if(touch){const cd=await context.newCDPSession(page),a=await drag.boundingBox();await cd.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:a.x+a.width/2,y:a.y+a.height/2}]});await cd.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:20,y:160}]});await cd.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cd.detach();}
  else{const a=await drag.boundingBox();await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();await page.mouse.move(20,160);await page.mouse.up();}
  assert.ok((await tools.boundingBox()).y<before.y-100);await page.waitForTimeout(120);assert.ok((await worker.evaluate(()=>chrome.storage.local.get('pageToolsPosition'))).pageToolsPosition);
  const anchor=await tools.boundingBox();await click(more);await page.waitForTimeout(60);await click(more);await page.waitForTimeout(60);const collapsed=await tools.boundingBox();assert.ok(Math.abs(anchor.x-collapsed.x)<1&&Math.abs(anchor.y-collapsed.y)<1,'menu growth cannot permanently move the chosen position');
  await page.reload();await tools.getByRole('button',{name:'采集当前作品',exact:true}).waitFor();assert.ok((await tools.boundingBox()).y<250,'position survives refresh');
  await click(more);await tools.getByRole('combobox',{name:'目标知识库'}).selectOption(collection.id);await click(tools.getByRole('button',{name:'框选截图',exact:true}));
  const region=page.locator('#znote-region-capture');await region.waitFor();assert.equal(await tools.locator('.tools').isHidden(),true);
  await page.mouse.move(100,180);await page.mouse.down();await page.mouse.move(260,300);await page.mouse.up();await click(region.getByRole('button',{name:'保存截图',exact:true}));
  await tools.getByRole('status').filter({hasText:'区域截图已保存'}).waitFor();assert.equal(await region.count(),0);assert.equal(await tools.locator('.tools').isVisible(),true);
  const saved=runtime.db.prepare("SELECT id FROM items WHERE collection_id=? AND title LIKE '%区域截图%' ORDER BY created_at DESC").get(collection.id);assert.ok(saved,'region saved with no extension action permission grant');
  const item=await(await context.request.get(base+'/api/items/'+saved.id)).json(),pixels=await sharp(await(await context.request.get(base+item.url)).body()).removeAlpha().raw().toBuffer();assert.ok(pixels.every((value,i)=>value===[18,52,86][i%3]),'saved region excludes toolbar, selector, help and feedback');
  // The extension popup waits for a selector acknowledgement, then closes;
  // selecting and saving remains owned by the page/background after it closes.
  const popup=await context.newPage();await popup.addInitScript(()=>{window.close=()=>{globalThis.__popupClosed=true;};});await popup.goto('chrome-extension://'+new URL(worker.url()).host+'/popup.html');await page.bringToFront();await popup.reload();await popup.waitForFunction(()=>document.body.dataset.ready==='true');
  await click(popup.locator('#capture-region'));await region.waitFor();await popup.waitForFunction(()=>globalThis.__popupClosed===true);await popup.close();await page.bringToFront();await click(region.getByRole('button',{name:'取消',exact:true}));await region.waitFor({state:'hidden'});
  await click(tools.getByRole('button',{name:'采集当前作品',exact:true}));await tools.getByRole('status').filter({hasText:/正在读取分享内容|正在保存配图/}).waitFor();await tools.locator('progress:visible').waitFor();
  await tools.getByRole('status').filter({hasText:'正在保存配图 2/2'}).waitFor();await page.screenshot({path:join(dir,`progress-${touch?'touch':'desktop'}.png`)});
  await tools.getByRole('status').filter({hasText:'图片组已入库'}).waitFor();assert.equal(page.url(),source);assert.equal(runtime.db.prepare("SELECT count(*) n FROM items WHERE collection_id=? AND group_key IS NOT NULL").get(collection.id).n,2);
  await click(more);await click(tools.getByRole('button',{name:'粘贴作品链接',exact:true}));await tools.getByRole('textbox',{name:'作品链接或分享文字'}).fill(source);await click(tools.getByRole('button',{name:'采集链接中的作品',exact:true}));await tools.getByRole('status').filter({hasText:'图片组已入库'}).waitFor();assert.equal(runtime.db.prepare("SELECT count(*) n FROM items WHERE collection_id=? AND group_key IS NOT NULL").get(collection.id).n,2,'pasted link deduplicates against current work');
  await click(tools.getByRole('button',{name:'关闭采集提示'}));assert.equal(await tools.getByRole('status').isHidden(),true);
  await worker.evaluate(()=>chrome.storage.local.set({blockedSites:['gallery.example']}));await tools.locator('.tools').waitFor({state:'hidden'});await worker.evaluate(()=>chrome.storage.local.set({blockedSites:[]}));await tools.locator('.tools').waitFor();
  await worker.evaluate(()=>chrome.storage.local.set({token:''}));await click(more);await click(tools.getByRole('button',{name:'可见页面截图'}));await tools.getByRole('status').filter({hasText:'令牌'}).waitFor();assert.equal(await tools.locator('.tools').isVisible(),true);
  await worker.evaluate(token=>chrome.storage.local.set({token}),token.token);await click(more);await click(tools.getByRole('button',{name:'框选截图'}));await region.waitFor();await page.keyboard.press('Escape');await region.waitFor({state:'hidden'});
  await page.setViewportSize({width:320,height:540});await click(more);assert.equal(await tools.evaluate(node=>{const b=node.getBoundingClientRect();return b.x>=0&&b.right<=innerWidth&&b.bottom<=innerHeight;}),true);await page.screenshot({path:join(dir,`narrow-${touch?'touch':'desktop'}.png`)});
  await context.close();context=null;
 }
 console.log('PASS unified page tools: non-X work, real stages/counts, saved destination, desktop/touch drag/persistence, help/Escape, region from popup button (popup document closes after acknowledgement) and page without activeTab gesture, clean pixels/close/failure recovery, blacklist and narrow viewport; evidence '+dir);
}finally{await context?.close();for(const key of ['captures','imports','trash','backups','webhooks','weixin'])await runtime[key].stop();await new Promise(r=>server.close(r));runtime.db.close();}
