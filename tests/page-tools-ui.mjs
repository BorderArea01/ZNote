import {chromium} from 'playwright';
import {mkdtemp,cp,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {createApp} from '../server/app.js';
const dir=await mkdtemp(resolve('artifacts/page-tools-')),extension=join(dir,'extension'),source='https://x.com/artist/status/2107462064294051944';
await cp(resolve('addons/browser/clipper'),extension,{recursive:true});
const background=join(extension,'background.js');
await writeFile(background,(await readFile(background,'utf8')).replace("chrome.runtime.onMessage.addListener((message, sender, reply) => {",`chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if(message.type==='znote-post-ready'&&globalThis.__testFault){if(globalThis.__testFault==='empty')reply();else if(globalThis.__testFault==='once'){globalThis.__testFault='';reply();}else reply({ok:true,protocol:0});return;}
`));
const png=await sharp({create:{width:100,height:150,channels:3,background:'#769e85'}}).png().toBuffer();
const runtime=createApp({dataDir:join(dir,'data'),captureOptions:{page:async()=>({plan:{kind:'note',url:source,title:'作品',content:'正文',images:['https://pbs.twimg.com/media/one.jpg','https://pbs.twimg.com/media/two.jpg']}}),image:async()=>png}});
const server=runtime.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
let context;
try{
 for(const touch of [false,true]){
  context=await chromium.launchPersistentContext(join(dir,touch?'touch':'desktop'),{channel:'msedge',headless:true,hasTouch:touch,viewport:{width:touch?390:1100,height:840},args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  await context.request.post(base+(touch?'/api/auth/login':'/api/auth/setup'),{data:{password:'0123'}});const token=await (await context.request.post(base+'/api/tokens',{data:{name:'tools',scope:'write'}})).json();
  await worker.evaluate(config=>chrome.storage.local.set(config),{server:base,token:token.token});
  await context.route('https://x.com/**',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:'<!doctype html><html><body style="background:#111;color:white;font:16px system-ui"><main style="padding:30px">继续浏览作品</main></body></html>'}));
  const page=await context.newPage();await page.goto(source);const save=page.locator('#znote-x-page-button'),tools=page.locator('[data-znote-page-tools]'),feedback=tools.locator('.feedback'),click=node=>touch?node.tap():node.click();
  await save.waitFor();await tools.getByRole('button',{name:'ZNote 视频嗅探',exact:true}).waitFor();assert.equal(await tools.count(),1);assert.equal(await tools.locator('.actions [data-tool]').count(),2);
  await tools.evaluate(node=>node.remove());await save.waitFor();assert.equal(await tools.count(),1);assert.equal(await tools.locator('.actions [data-tool]').count(),2);
  await worker.evaluate(()=>globalThis.__testFault='empty');await click(save);await feedback.filter({hasText:'扩展后台未响应'}).waitFor();assert.equal(await page.locator('.znote-post-toast').count(),0);assert.equal(runtime.db.prepare('SELECT count(*) n FROM items').get().n,touch?2:0);
  await page.screenshot({path:join(dir,`failure-${touch?'touch':'desktop'}.png`)});
  await click(tools.getByRole('button',{name:'关闭采集提示'}));assert.equal(await feedback.isHidden(),true);assert.equal(await save.isVisible(),true);
  await worker.evaluate(()=>globalThis.__testFault='mismatch');await click(save);await feedback.filter({hasText:'重新加载'}).waitFor();
  await worker.evaluate(()=>globalThis.__testFault='once');await click(save);await save.filter({hasText:'已保存'}).waitFor({timeout:15000});assert.equal(runtime.db.prepare('SELECT count(*) n FROM items').get().n,2);assert.equal(page.url(),source);
  await click(tools.getByRole('button',{name:'ZNote 视频嗅探',exact:true}));const panel=page.getByRole('dialog',{name:'ZNote 视频嗅探',exact:true});await panel.waitFor();
  await page.waitForTimeout(200);const [a,b]=await Promise.all([tools.boundingBox(),panel.boundingBox()]);assert.ok(b.y+b.height<=a.y-10,'video panel and feedback must not overlap');
  await save.focus();await page.keyboard.press('Escape');await panel.waitFor({state:'hidden'});await feedback.waitFor({state:'hidden'});
  await page.setViewportSize({width:320,height:640});assert.equal(await tools.evaluate(node=>{const b=node.getBoundingClientRect();return b.left>=0&&b.right<=innerWidth;}),true);
  await page.screenshot({path:join(dir,`toolbar-${touch?'touch':'desktop'}.png`)});
  const restarted=context.waitForEvent('serviceworker');await worker.evaluate(()=>chrome.runtime.reload());await restarted;await click(save);await feedback.filter({hasText:'重新加载'}).waitFor();await page.reload();await save.waitFor();await click(save);await save.filter({hasText:'已保存'}).waitFor({timeout:15000});
  await context.close();context=null;
 }
 console.log('PASS shared page toolbar: desktop/touch, empty response retry, old protocol detection, server save/deduplication, feedback close/Escape, video panel separation, narrow viewport and extension reload recovery; evidence '+dir);
}finally{await context?.close();for(const key of ['captures','imports','trash','backups','webhooks','weixin'])await runtime[key].stop();await new Promise(r=>server.close(r));runtime.db.close();}
