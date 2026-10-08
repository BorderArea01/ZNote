import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {mkdtemp,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {createApp} from '../server/app.js';

const dir=await mkdtemp(resolve('artifacts/save-mode-')),extension=resolve(process.env.LIVE_EXTENSION||'addons/browser/clipper');
const png=await sharp({create:{width:300,height:200,channels:3,background:'#123456'}}).png().toBuffer(),video=await readFile('tests/fixtures/sample.mp4');
const media=createServer((req,res)=>{if(req.url==='/bad.png'){res.writeHead(403);res.end();return;}const mp4=req.url.endsWith('.mp4');res.writeHead(200,{'Content-Type':mp4?'video/mp4':'image/png'});res.end(mp4?video:png);});
media.listen(0,'127.0.0.1');await new Promise(r=>media.once('listening',r));const cdn='http://127.0.0.1:'+media.address().port;
const source='https://gallery.example/one';let slow=false;
const runtime=createApp({dataDir:join(dir,'data'),captureOptions:{page:async url=>{
  if(slow)await new Promise(r=>setTimeout(r,1200));
  return {plan:{kind:'note',url,title:'保存方式验收',content:'作品正文',images:[cdn+'/one.png',cdn+'/cover.png',cdn+'/two.png'],live_videos:[{index:1,urls:[cdn+'/live.mp4']} ]}};
},image:async()=>png}});
const server=runtime.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
let context;
try{
 for(const touch of [false,true]){
  context=await chromium.launchPersistentContext(join(dir,touch?'touch':'desktop'),{channel:'msedge',headless:true,hasTouch:touch,viewport:{width:touch?390:1100,height:840},args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  context.setDefaultTimeout(15000);
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker'),extensionBase='chrome-extension://'+new URL(worker.url()).host;
  await context.request.post(base+(touch?'/api/auth/login':'/api/auth/setup'),{data:{password:'0123'}});
  const token=await(await context.request.post(base+'/api/tokens',{data:{name:'保存方式验收',scope:'write'}})).json();
  await worker.evaluate(config=>chrome.storage.local.set(config),{server:base,token:token.token});
  await context.route('https://cdn.example/**',route=>route.fulfill({contentType:route.request().url().endsWith('.mp4')?'video/mp4':'image/png',body:route.request().url().endsWith('.mp4')?video:png}));
  await context.route('https://gallery.example/**',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<!doctype html><html style="background:#123456"><body><main><h1>当前作品</h1><article><img id="cover" src="https://cdn.example/one.png" width="300" height="200"></article><section><video src="https://cdn.example/live.mp4" controls></video></section></main></body></html>`}));
  const page=await context.newPage();await page.goto(source);const cd=await context.newCDPSession(page);await cd.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:join(dir,touch?'downloads-touch':'downloads-desktop')});
  const click=node=>touch?node.tap():node.click(),tools=page.locator('[data-znote-page-tools]'),overlay=page.locator('[data-znote-overlay]'),more=tools.getByRole('button',{name:'更多采集方式'});
  await tools.getByRole('button',{name:'采集当前作品',exact:true}).waitFor();
  const options=await context.newPage();await options.goto(extensionBase+'/options.html');await options.waitForFunction(()=>document.body.dataset.ready==='true');assert.equal(await options.locator('#save-action').inputValue(),'save');
  await options.locator('#save-action').selectOption('download');assert.equal(await options.locator('#save-key').isHidden(),true);assert.equal(await options.locator('#download-key').isVisible(),true);await click(options.locator('#behavior button[type=submit]'));
  await tools.getByRole('button',{name:'下载当前作品',exact:true}).waitFor();assert.equal((await worker.evaluate(()=>chrome.storage.local.get('saveAction'))).saveAction,'download');
  await options.reload();await options.waitForFunction(()=>document.body.dataset.ready==='true');assert.equal(await options.locator('#save-action').inputValue(),'download');
  await click(options.getByRole('button',{name:'默认保存方式说明',exact:true}));assert.equal(await options.locator('.help-tooltip').filter({hasText:'下载不会创建'}).isVisible(),true);await options.keyboard.press('Escape');
  await options.screenshot({path:join(dir,`options-${touch?'touch':'desktop'}.png`)});await options.close();await page.bringToFront();
  await click(more);assert.equal(await tools.locator('select').isHidden(),true);await tools.getByRole('button',{name:'下载页面正文',exact:true}).waitFor();await page.screenshot({path:join(dir,`menu-${touch?'touch':'desktop'}.png`)});await page.keyboard.press('Escape');
  // One visible operation in both image and video discovery controls.
  await page.locator('#cover').hover();const preview=overlay.locator('.preview');await preview.waitFor({state:'visible'});
  await preview.getByRole('button',{name:'S 下载',exact:true}).waitFor();assert.equal(await preview.getByRole('button',{name:'Z 保存知识库',exact:true}).isHidden(),true);assert.equal(await preview.getByRole('button',{name:'目标知识库',exact:true}).isHidden(),true);
  const beforeDownloads=(await worker.evaluate(()=>chrome.downloads.search({}))).length;
  await page.keyboard.press('z');await page.waitForTimeout(150);assert.equal((await worker.evaluate(()=>chrome.downloads.search({}))).length,beforeDownloads,'opposite shortcut disabled');
  await page.keyboard.press('Escape');await click(tools.getByRole('button',{name:/视频/}));await overlay.locator('.item').first().waitFor();assert.equal(await overlay.locator('[data-save-action="save"]:visible').count(),0);await overlay.locator('[data-save-action="download"]:visible').first().waitFor();await page.keyboard.press('Escape');
  const beforeItems=runtime.db.prepare('SELECT count(*) n FROM items').get().n,beforeJobs=runtime.captures.list().length;
  slow=true;await click(tools.getByRole('button',{name:'下载当前作品',exact:true}));
  await tools.getByRole('status').filter({hasText:'正在解析作品资源'}).waitFor();
  await worker.evaluate(()=>chrome.storage.local.set({saveAction:'save'}));
  await tools.getByRole('status').filter({hasText:'3 项下载完成'}).waitFor({timeout:30000});slow=false;
  const downloads=await worker.evaluate(()=>chrome.downloads.search({}));assert.equal(downloads.length-beforeDownloads,3);assert.ok(downloads.every(d=>d.state==='complete'));
  for(const d of downloads){const data=await readFile(d.filename);assert.deepEqual(data,d.filename.endsWith('.mp4')?video:png);}
  assert.equal(runtime.db.prepare('SELECT count(*) n FROM items').get().n,beforeItems);assert.equal(runtime.captures.list().length,beforeJobs,'download creates no capture record');
  await page.screenshot({path:join(dir,`completed-${touch?'touch':'desktop'}.png`)});
  await click(tools.getByRole('button',{name:'关闭采集提示'}));await tools.getByRole('button',{name:'采集当前作品',exact:true}).waitFor();
  await page.locator('#cover').hover();await preview.waitFor({state:'visible'});await preview.getByRole('button',{name:'Z 保存知识库',exact:true}).waitFor();assert.equal(await preview.getByRole('button',{name:'S 下载',exact:true}).isHidden(),true);await page.keyboard.press('Escape');
  // Screenshot download also avoids all library endpoints and survives closing menu.
  await worker.evaluate(()=>chrome.storage.local.set({saveAction:'download',token:''}));await tools.getByRole('button',{name:'下载当前作品',exact:true}).waitFor();await click(more);await click(tools.getByRole('button',{name:'可见页面截图',exact:true}));await tools.getByRole('status').filter({hasText:'下载完成'}).waitFor();
  assert.equal(runtime.db.prepare('SELECT count(*) n FROM items').get().n,beforeItems);assert.equal(runtime.captures.list().length,beforeJobs);
  await click(tools.getByRole('button',{name:'关闭采集提示'}));await click(tools.getByRole('button',{name:'下载当前作品',exact:true}));await tools.getByRole('status').filter({hasText:'令牌'}).waitFor();assert.equal(await tools.getByRole('button',{name:'下载当前作品',exact:true}).isEnabled(),true);
  await worker.evaluate(token=>chrome.storage.local.set({token}),token.token);await click(more);await click(tools.getByRole('button',{name:'框选截图',exact:true}));await page.locator('#znote-region-capture').waitFor();await page.keyboard.press('Escape');assert.equal(await tools.locator('.tools').isVisible(),true);
  await context.close();context=null;
 }
 console.log('PASS save mode: persisted selection, mouse/touch menus/help, one image/video action and shortcut, three real browser downloads incl live video, no library writes, in-flight mode snapshot, screenshot with no credentials, failure recovery; '+dir);
}finally{await context?.close();for(const key of ['captures','imports','trash','backups','webhooks','weixin'])await runtime[key].stop();await new Promise(r=>server.close(r));await new Promise(r=>media.close(r));runtime.db.close();}
