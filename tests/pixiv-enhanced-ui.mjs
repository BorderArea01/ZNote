import { chromium } from 'playwright';
import { mkdtemp, mkdir, writeFile, readFile, cp } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import archiver from 'archiver';
import yauzl from 'yauzl';
import { PassThrough } from 'node:stream';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { createApp } from '../server/app.js';
import { originalBuffer } from '../server/storage.js';
const dir = await mkdtemp(resolve('artifacts/pixiv-enhanced-')), extension = join(dir,'extension');
await cp(resolve('integrations/pixiv/build/extension'),extension,{recursive:true});
// Chrome's native optional-host permission prompt is outside headless page
// automation. Pregrant only the isolated API host in the fixture manifest.
const manifest=JSON.parse(await readFile(join(extension,'manifest.json'),'utf8'));
manifest.host_permissions.push('http://127.0.0.1/*');await writeFile(join(extension,'manifest.json'),JSON.stringify(manifest));
const runtime = createApp({ dataDir: join(dir,'data'), staticDir: resolve('dist') }), server = runtime.app.listen(0,'127.0.0.1');
await new Promise(r=>server.once('listening',r)); const base = `http://127.0.0.1:${server.address().port}`;
const originals = await Promise.all(['#67967c','#ad8867'].map(background => sharp({create:{width:800,height:600,channels:3,background}}).png().toBuffer()));
const frameBuffers = await Promise.all(originals.map(b => sharp(b).resize(64,48).jpeg().toBuffer()));
const zip = archiver('zip'), output = new PassThrough(), chunks = []; output.on('data', b => chunks.push(b)); zip.pipe(output);
const zipped = new Promise((resolve, reject) => { output.on('end', resolve); zip.on('error', reject); });
frameBuffers.forEach((b,i)=>zip.append(b,{name:`00000${i}.jpg`})); await zip.finalize(); await zipped; const animationZip = Buffer.concat(chunks);
const original = 'https://i.pximg.net/img-original/img/2026/01/01/00/00/00/12345_p0.png';
const common = { id:'12345', title:'森林与清晨', description:'<p>系列说明 <a href="https://www.pixiv.net/users/1">作者主页</a></p>', userId:'1', userName:'测试作者', width:800,height:600,pageCount:2,bookmarkCount:120,illustType:1,tags:{tags:[{tag:'风景',translation:{en:'landscape'}}]},urls:{original,regular:original,small:original,thumb:original},aiType:1,illustAIType:1,isOriginal:true,createDate:'2026-01-01T00:00:00Z',uploadDate:'2026-01-01T00:00:00Z',xRestrict:0,sl:2,bookmarkData:null,likeCount:3,viewCount:12,commentCount:0 };
let context, worker, page, failSecond = true, loseNoteResponse = false;
const headers = [], errors = [], apiWrites = [];
await mkdir(join(dir,'profile','Default'),{recursive:true}); await mkdir(join(dir,'downloads'));
await writeFile(join(dir,'profile','Default','Preferences'),JSON.stringify({download:{default_directory:join(dir,'downloads'),prompt_for_download:false,directory_upgrade:true}}));
async function launch() {
  const clipper=resolve('extensions/clipper');
  context = await chromium.launchPersistentContext(join(dir,'profile'),{channel:'msedge',headless:true,args:[`--disable-extensions-except=${extension},${clipper}`,`--load-extension=${extension},${clipper}`],viewport:{width:1500,height:1100}});
  worker=context.serviceWorkers().find(w=>w.url().endsWith('/js/background.js'))||await context.waitForEvent('serviceworker',{predicate:w=>w.url().endsWith('/js/background.js')});
  await context.route('https://**/*',async route=>{
    const u = new URL(route.request().url()); headers.push(route.request().headers());
    if(u.hostname.endsWith('pximg.net')) {
      if(u.pathname.endsWith('.zip')) return route.fulfill({contentType:'application/zip',body:animationZip});
      if(u.pathname.includes('_p1')&&failSecond)return route.fulfill({status:404});
      return route.fulfill({contentType:'image/png',body:originals[u.pathname.includes('_p1')?1:0]});
    }
    if(u.pathname==='/ajax/illust/12345')return route.fulfill({json:{error:false,body:common}});
    if(u.pathname.includes('/pages'))return route.fulfill({json:{error:false,body:[{urls:common.urls},{urls:{...common.urls,original:original.replace('p0','p1')}}]}});
    if(u.pathname.startsWith('/ajax'))return route.fulfill({json:{error:false,body:{illusts:{12345:null},manga:{},works:[],following:[],total:0}}});
    return route.fulfill({contentType:'text/html;charset=utf-8',body:`<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>测试作品</title><script>var test="user_id:'1'"</script></head><body><div><div><main><h1>森林与清晨</h1><img src="${original}"></main><aside></aside></div></div></body></html>`});
  });
  await context.route(base+'/api/**',async route=>{
    if(route.request().method()==='POST')apiWrites.push(route.request().url());
    if(loseNoteResponse&&route.request().url().endsWith('/api/pixiv/notes')) {loseNoteResponse=false;await route.fetch();return route.abort('failed');}
    return route.continue();
  });
}
async function closeNotices() {
  for(let i=0;i<5;i++){const buttons=page.getByRole('button',{name:'我知道了',exact:true});if(!await buttons.count())break;await buttons.first().click();}
}
async function zipNames(bytes) {
  return new Promise((resolve,reject)=>yauzl.fromBuffer(bytes,{lazyEntries:true},(e,z)=>{if(e)return reject(e);const names=[];z.on('entry',entry=>{names.push(entry.fileName);z.readEntry();});z.on('end',()=>resolve(names));z.on('error',reject);z.readEntry();}));
}
async function openCapture() {
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('closeSettingsPanel')));
  const entry=page.locator('#znote-pixiv-entry');
  if(await entry.locator('#panel').isHidden())await entry.locator('#toggle').click();
  await entry.locator('#save:not([disabled])').waitFor();
  const opened=context.waitForEvent('page');await entry.locator('#review').click();
  const target=await opened;target.on('pageerror',e=>errors.push(e.message));await target.locator('#task').waitFor();return target;
}
try {
  await launch();
  await context.request.post(base+'/api/auth/setup',{data:{password:'0059'}});
  const token=await(await context.request.post(base+'/api/tokens',{data:{name:'Pixiv 集成测试',scope:'write'}})).json();
  const collection=await(await context.request.post(base+'/api/collections',{data:{name:'Pixiv 收藏'}})).json();
  await worker.evaluate(()=>chrome.storage.local.set({xzSetting:{autoStartDownload:false,autoStartDownloadForQuickDownload:false}}));
  page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));const cdp=await context.newCDPSession(page);await cdp.send('Browser.setDownloadBehavior',{behavior:'default'});
  await page.goto('https://www.pixiv.net/artworks/12345');await page.locator('#znote-pixiv-entry').waitFor({state:'attached'});await closeNotices();
  await page.locator('[data-znote-overlay]').waitFor({state:'attached'});await page.locator('main img').hover();await page.waitForTimeout(450);
  assert.ok(await page.locator('[data-znote-overlay]').locator('.preview').isHidden(),'Universal clipper yields hover preview to companion on Pixiv');
  await page.locator('#quickCrawlBtn').click();
  await page.locator('#znote-pixiv-entry').getByText('保存抓取结果到 ZNote（2）',{exact:true}).waitFor({state:'attached'});await closeNotices();
  const target=await openCapture();
  await target.locator('#server').fill(base);await target.locator('#token').fill(token.token);
  await target.locator('#connect').click();await target.locator('#connection-status').filter({hasText:'已连接'}).waitFor();console.log('Connected through extension UI');
  await target.locator('#collection').selectOption(collection.id);await target.locator('#tags').fill('参考,漫画');
  await target.locator('#start').click();await target.locator('#status').filter({hasText:'已入库 1 / 2，1 项失败'}).waitFor();
  let rows=runtime.db.prepare("SELECT * FROM items WHERE kind='image'").all();assert.equal(rows.length,1);assert.deepEqual(await originalBuffer(join(dir,'data'),rows[0]),originals[0]);
  const jobURL=target.url();await context.close();failSecond=false;await launch();
  const restored=await context.newPage();await restored.goto(jobURL);await restored.locator('#connection-status').filter({hasText:'已连接'}).waitFor();
  assert.equal(await restored.locator('#collection').inputValue(),collection.id);assert.ok(await restored.locator('#collection').isDisabled());
  await restored.locator('#start').click();await restored.getByRole('button',{name:'全部已入库',exact:true}).waitFor();
  rows=runtime.db.prepare("SELECT * FROM items WHERE kind='image'").all();assert.equal(rows.length,2);
  for(const row of rows){assert.equal(row.collection_id,collection.id);assert.equal(row.source_url,'https://www.pixiv.net/artworks/12345');for(const tag of ['Pixiv','测试作者','风景','参考','漫画'])assert.ok(JSON.parse(row.tags).includes(tag));}
  await restored.locator('#status').filter({hasText:'已入库 2 / 2。'}).waitFor();await restored.screenshot({path:resolve('artifacts/pixiv-enhanced-library.png'),fullPage:true});
  page=await context.newPage();await page.goto('https://www.pixiv.net/artworks/12345');await page.locator('#znote-pixiv-entry').waitFor({state:'attached'});await closeNotices();
  const template={idNum:12345,id:'12345',index:0,original,type:0,ext:'png',pageCount:1,title:'原插件导入测试',description:'',user:'测试作者',userId:'1',fullWidth:800,fullHeight:600,tags:['测试'],tagsWithTransl:['测试'],aiType:1,isOriginal:true,bmk:120,bookmarked:false,date:'2026-01-01T00:00:00Z',xRestrict:0,regular:original,thumb:original,small:original};
  const records=[{...template,idNum:23456,id:'23456',title:'两帧动图',type:2,ext:'zip',original:'https://i.pximg.net/img-zip-ugoira/23456.zip',ugoiraInfo:{frames:[{file:'000000.jpg',delay:100},{file:'000001.jpg',delay:200}] }},{...template,idNum:34567,id:'34567',title:'晨间小说',type:3,ext:'txt',original:'',novelMeta:{content:'[chapter:第一章]\n正文 [[jumpuri:作者>https://www.pixiv.net/users/1]]\n[uploadedimage:9]',coverUrl:original,embeddedImages:{'9':original.replace('p0','p1')}}}];
  const choose=page.waitForEvent('filechooser');await page.evaluate(()=>window.dispatchEvent(new CustomEvent('importResult')));const chooser=await choose;
  await chooser.setFiles({name:'pixiv-results.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(records))});
  await page.locator('#znote-pixiv-entry').getByText('保存抓取结果到 ZNote（2）',{exact:true}).waitFor({state:'attached'});
  const mixed=await openCapture();await mixed.locator('#connection-status').filter({hasText:'已连接'}).waitFor();await mixed.locator('#collection').selectOption(collection.id);
  loseNoteResponse=true;await mixed.locator('#start').click();await mixed.locator('#status').filter({hasText:'已入库 1 / 2，1 项失败'}).waitFor();
  let novels=runtime.db.prepare("SELECT * FROM items WHERE kind='note'").all();assert.equal(novels.length,1,'Novel committed despite dropped response');
  await mixed.locator('#start').click();await mixed.getByRole('button',{name:'全部已入库',exact:true}).waitFor();
  novels=runtime.db.prepare("SELECT * FROM items WHERE kind='note'").all();assert.equal(novels.length,1,'Retry must not duplicate novels');assert.ok(JSON.parse(novels[0].tags).includes('测试作者'));
  assert.ok(novels[0].content.includes('## 第一章'));assert.ok(novels[0].content.includes('[作者](<https://www.pixiv.net/users/1>)'));assert.ok(novels[0].content.includes('/media/'));assert.ok(!/!\[[^\]]*\]\(https?:/.test(novels[0].content));
  const animated=runtime.db.prepare("SELECT * FROM items WHERE source_url='https://www.pixiv.net/artworks/23456'").get();assert.ok(animated);
  assert.ok(JSON.parse(animated.tags).includes('测试作者'));
  const apng=await originalBuffer(join(dir,'data'),animated);
  const extensionOrigin='chrome-extension://'+new URL(mixed.url()).host;
  await mixed.addScriptTag({url:extensionOrigin+'/lib/pako.min.js'});await mixed.addScriptTag({url:extensionOrigin+'/lib/UPNG.js'});
  // libvips reads APNG's first PNG frame only. Decode the animation and the
  // original JPEGs in the browser used by the encoder to compare every pixel.
  const decoded=await mixed.evaluate(async ({png,jpegs})=>{
    const info=UPNG.decode(new Uint8Array(png).buffer), frames=UPNG.toRGBA8(info).map(b=>Array.from(new Uint8Array(b))), originals=[];
    for(const bytes of jpegs){const bitmap=await createImageBitmap(new Blob([new Uint8Array(bytes)],{type:'image/jpeg'})),canvas=new OffscreenCanvas(bitmap.width,bitmap.height),ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);originals.push(Array.from(ctx.getImageData(0,0,bitmap.width,bitmap.height).data));bitmap.close();}
    return{delays:info.frames.map(f=>f.delay),frames,originals};
  },{png:[...apng],jpegs:frameBuffers.map(b=>[...b])});
  assert.deepEqual(decoded.delays,[100,200]);assert.deepEqual(decoded.frames,decoded.originals,'APNG preserves decoded frame pixels');
  await mixed.setViewportSize({width:390,height:844});assert.ok(await mixed.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await mixed.screenshot({path:resolve('artifacts/pixiv-enhanced-mobile.png'),fullPage:true});
  assert.ok(headers.every(h=>!h.authorization),'No API token sent to Pixiv/CDN');
  assert.equal((await worker.evaluate(()=>chrome.downloads.search({}))).length,0,'Library jobs do not trigger original downloader output');
  // The original download pipeline and its naming/output behavior remain usable.
  await page.bringToFront(); await closeNotices();
  const replaceResult=page.waitForEvent('filechooser');
  await page.evaluate(()=>{window.__ppdImported=false;window.addEventListener('crawlComplete',()=>window.__ppdImported=true,{once:true});window.dispatchEvent(new CustomEvent('importResult'));});
  await(await replaceResult).setFiles({name:'original-download.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify([{...template,pageCount:2}]))});
  await page.waitForFunction(()=>window.__ppdImported);await closeNotices();
  const downloadSession=await context.newCDPSession(page);await downloadSession.send('Browser.setDownloadBehavior',{behavior:'default'});
  if(!await page.getByRole('button',{name:'开始下载',exact:true}).first().isVisible())await page.locator('#openSettingsPanelBtn').click();
  await page.getByRole('button',{name:'开始下载',exact:true}).first().click();
  const complete=await worker.evaluate(async()=>{for(let n=0;n<100;n++){const files=await chrome.downloads.search({});if(files.length===2&&files.every(f=>f.state==='complete'))return true;await new Promise(r=>setTimeout(r,200));}return false;});
  if(!complete){console.log('download diagnostics',await worker.evaluate(()=>chrome.downloads.search({})));console.log('page status',(await page.locator('body').innerText()).slice(-4500));await page.screenshot({path:resolve('artifacts/ppd-download-failure.png')});}
  assert.ok(complete);
  const downloaded=await worker.evaluate(()=>chrome.downloads.search({}));
  for(const file of downloaded){assert.ok(resolve(file.filename).startsWith(resolve(dir)));const bytes=await readFile(file.filename);assert.ok(originals.some(original=>original.equals(bytes)));}
  for(const artifact of ['download','source']) {
    const response=await context.request.get(base+'/api/clipper/pixiv/'+artifact,{headers:{Authorization:'Bearer '+token.token}});assert.ok(response.ok());
    const names=await zipNames(await response.body());
    for(const path of artifact==='download'?['manifest.json','znote/index.js','LICENSE']:['upstream.zip','integrations/pixiv/bridge/index.js','integrations/pixiv/LICENSE','scripts/build-pixiv.mjs'])assert.ok(names.includes(path),path);
  }
  await context.request.post(base+'/api/auth/login',{data:{password:'0059'}});
  const backup=await context.request.get(base+'/api/export?mode=backup');assert.ok(backup.ok());
  const archive=join(dir,'backup.zip');await writeFile(archive,await backup.body());
  const restoredRuntime=createApp({dataDir:join(dir,'restored')});
  try {
    const preview=await restoredRuntime.backups.preview(archive);await restoredRuntime.backups.restore(preview.id);
    for(const row of runtime.db.prepare("SELECT * FROM items WHERE kind='image'").all())assert.deepEqual(await originalBuffer(join(dir,'restored'),restoredRuntime.db.prepare('SELECT * FROM items WHERE id=?').get(row.id)),await originalBuffer(join(dir,'data'),row));
    assert.equal(restoredRuntime.db.prepare("SELECT content FROM items WHERE kind='note'").get().content,novels[0].content);
  }finally{await restoredRuntime.imports.stop();await restoredRuntime.backups.stop();await restoredRuntime.webhooks.stop();restoredRuntime.db.close();}
  assert.deepEqual(errors,[]);
  console.log('PASS: actual upstream quick crawl/result import and original downloads; native ZNote entry and companion hover coexistence; original bytes, source/tags/library isolation; restart resume; APNG frame pixels/timing; Markdown/local novel images; dropped-response deduplication; no token leaks; mobile layout; install/source packages; backup restoration of images, animation and novels');
} catch(e){if(page&&!page.isClosed()){await page.screenshot({path:resolve('artifacts/pixiv-regression-failure.png'),timeout:5000});console.log('overlap',await page.locator('#settingsPanelSummaryStart').boundingBox(),await page.locator('#znote-pixiv-entry').boundingBox());}throw e;} finally {await context?.close();await runtime.imports.stop();await runtime.backups.stop();await runtime.webhooks.stop();await new Promise(r=>server.close(r));runtime.db.close();}
