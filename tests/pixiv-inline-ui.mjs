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
const dir = await mkdtemp(resolve('artifacts/pixiv-inline-')), extension = join(dir,'extension');
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
let context, worker, page, failSecond = true, loseNoteResponse = false, slowMedia=false;
let transientMode='',permanentFirst=false;const mediaAttempts=new Map();
const metaRequests=new Set();
const directoryIDs=Array.from({length:120},(_,i)=>String(50000+i));
const directoryFiles=new Map(await Promise.all(directoryIDs.map(async(id,i)=>[id,await sharp({create:{width:64,height:48,channels:3,background:{r:i,g:44,b:212}}}).png().toBuffer()])));
const headers = [], errors = [], apiWrites = [], bookmarks=[];let failBookmark=true;
await mkdir(join(dir,'profile','Default'),{recursive:true}); await mkdir(join(dir,'downloads'));
await writeFile(join(dir,'profile','Default','Preferences'),JSON.stringify({download:{default_directory:join(dir,'downloads'),prompt_for_download:false,directory_upgrade:true}}));
async function launch() {
  const clipper=resolve('extensions/clipper');
  context = await chromium.launchPersistentContext(join(dir,'profile'),{channel:'msedge',headless:true,args:[`--disable-extensions-except=${extension},${clipper}`,`--load-extension=${extension},${clipper}`],viewport:{width:1500,height:1100}});
  context.on('page',p=>p.on('dialog',d=>{console.log('native dialog',d.type(),d.message().slice(0,120));d.accept()}));
  worker=context.serviceWorkers().find(w=>w.url().endsWith('/js/background.js'))||await context.waitForEvent('serviceworker',{predicate:w=>w.url().endsWith('/js/background.js')});
  await context.route('https://**/*',async route=>{
    const u = new URL(route.request().url()); headers.push(route.request().headers());
    if(u.hostname.endsWith('pximg.net')) {
      if(slowMedia)await new Promise(r=>setTimeout(r,1000));
      if(u.pathname.endsWith('.zip')) return route.fulfill({contentType:'application/zip',body:animationZip});
      if(u.pathname.includes('_p1')&&failSecond)return route.fulfill({status:404});
      return route.fulfill({contentType:'image/png',body:originals[u.pathname.includes('_p1')?1:0]});
    }
    const match=u.pathname.match(/^\/ajax\/illust\/(\d+)$/);
    if(match){metaRequests.add(match[1]);const id=match[1];const urls=Object.fromEntries(Object.entries(common.urls).map(([k,v])=>[k,v.replace('12345',id)]));return route.fulfill({json:{error:false,body:{...common,id,title:'测试作品 '+id,urls,pageCount:id==='12345'?2:1}}});}
    if(u.pathname==='/ajax/user/1/profile/all')return route.fulfill({json:{error:false,body:{illusts:Object.fromEntries(directoryIDs.map(id=>[id,null])),manga:{},novels:{}}}});
    if(u.pathname.includes('/pages')){const id=u.pathname.split('/')[3];return route.fulfill({json:{error:false,body:Array.from({length:id==='12345'?2:1},(_,i)=>({urls:{original:original.replace('12345',id).replace('p0','p'+i)}}))}});}
    if(u.pathname==='/ajax/illusts/bookmarks/add') { const data=route.request().postDataJSON();bookmarks.push(data);assert.ok(runtime.db.prepare('SELECT id FROM items WHERE source_url=?').get('https://www.pixiv.net/artworks/'+data.illust_id),'Bookmark only after library upload'); if(failBookmark){failBookmark=false;return route.fulfill({status:403,json:{error:true}})}return route.fulfill({json:{error:false,body:{last_bookmark_id:'10'}}}); }
    if(u.pathname.startsWith('/ajax'))return route.fulfill({json:{error:false,body:{illusts:{12345:null},manga:{},works:[],following:[],total:0}}});
    return route.fulfill({contentType:'text/html;charset=utf-8',body:`<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>测试作品</title><script>var test="user_id:'1'"</script></head><body><div><div><main><h1>受控测试目录</h1><a class="fixture-card" href="/artworks/12345" style="display:inline-block;width:150px"><img width="150" src="${original}"></a><a class="fixture-small" href="/artworks/22222" style="display:inline-block;width:60px"><img width="60" src="${original}"></a></main><aside><a href="https://www.pixiv.net/users/1">测试作者</a></aside></div></div></body></html>`});
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
  const entry=page.locator('#znote-pixiv-entry');
  if(await entry.locator('#panel').isHidden())await entry.locator('#toggle').click();
  await entry.locator('#save:not([disabled])').waitFor();
  const opened=context.waitForEvent('page');await entry.locator('#review').click();
  const target=await opened;target.on('pageerror',e=>errors.push(e.message));await target.locator('#task').waitFor();return target;
}

// Offscreen extension documents are CDP "other" targets, outside Playwright's page routing.
async function offscreenFixtures(){
  await worker.evaluate(()=>chrome.offscreen.createDocument({url:'znote/runner.html',reasons:['DOM_PARSER','WORKERS','BLOBS'],justification:'Isolated integration fixture'}));
  const cdp=await context.browser().newBrowserCDPSession();
  const {targetInfos}=await cdp.send('Target.getTargets');
  const t=targetInfos.find(t=>t.url.endsWith('/znote/runner.html'));assert.ok(t);
  const {sessionId}=await cdp.send('Target.attachToTarget',{targetId:t.targetId,flatten:false});let sequence=0;
  const command=(method,params)=>cdp.send('Target.sendMessageToTarget',{sessionId,message:JSON.stringify({id:++sequence,method,params})});
  cdp.on('Target.receivedMessageFromTarget',async event=>{
    if(event.sessionId!==sessionId)return;const m=JSON.parse(event.message);if(m.method!=='Fetch.requestPaused')return;
    const {requestId,request}=m.params,u=new URL(request.url);headers.push(request.headers);let status=200,body,contentType='application/json';
    if(u.hostname.endsWith('pximg.net')){
      const count=(mediaAttempts.get(u.pathname)||0)+1;mediaAttempts.set(u.pathname,count);
      if(transientMode==='disconnect' && u.pathname.includes('_p1') && count===1){await command('Fetch.failRequest',{requestId,errorReason:'InternetDisconnected'});return;}
      if(slowMedia)await new Promise(r=>setTimeout(r,1000));contentType='image/png';
      status=failSecond&&u.pathname.includes('_p1')?404:transientMode && transientMode!=='disconnect' && u.pathname.includes('_p1') && (count===1 || transientMode==='always')?503:200;
      if(permanentFirst && u.pathname.includes('_p0')) status=403;
      body=directoryFiles.get(u.pathname.match(/(\d+)_p/)?.[1])||originals[u.pathname.includes('_p1')?1:0];
    }
    else if(u.pathname.match(/^\/ajax\/illust\/\d+$/)){const id=u.pathname.split('/')[3];metaRequests.add(id);body={error:false,body:{...common,id,title:'测试作品 '+id}};}
    else if(u.pathname.endsWith('/pages')){const id=u.pathname.split('/')[3];body={error:false,body:Array.from({length:id==='12345'?2:1},(_,i)=>({urls:{original:original.replace('12345',id).replace('p0','p'+i)}}))};}
    else{status=404;body={error:true,message:'Missing fixture'};}
    if(!Buffer.isBuffer(body))body=Buffer.from(JSON.stringify(body));
    await command('Fetch.fulfillRequest',{requestId,responseCode:status,responseHeaders:[{name:'content-type',value:contentType}],body:body.toString('base64')}).catch(()=>{});
  });
  await command('Fetch.enable',{patterns:[{urlPattern:'https://*',requestStage:'Request'}]});
}
async function queryDB(prefix, key){return worker.evaluate(async({prefix,key})=>{const db=await new Promise((yes,no)=>{const q=indexedDB.open('znote-pixiv',1);q.onsuccess=()=>yes(q.result);q.onerror=()=>no(q.error)});const value=await new Promise((yes,no)=>{const store=db.transaction('data').objectStore('data');const q=key?store.get(key):store.getAll(IDBKeyRange.bound(prefix,prefix+'\uffff'));q.onsuccess=()=>yes(q.result);q.onerror=()=>no(q.error)});db.close();return value},{prefix,key})}
async function dbJob(id){const job=await queryDB('', 'job:'+id);if(job){const results=await queryDB('result:'+id+':');for(const r of job.records){const status=results.find(s=>s.key===r.key);if(status)Object.assign(r,status)}}return job}
async function allJobs(){return queryDB('summary:')}
async function waitJob(id,state,timeout=90000){const start=Date.now();while(Date.now()-start<timeout){const j=await dbJob(id);if(j?.state===state)return j;if(j?.state==='failed'&&state!=='failed')throw Error(JSON.stringify({error:j.error,records:j.records.filter(r=>r.status==='failed').slice(0,2)}));await new Promise(r=>setTimeout(r,200))}throw Error('Job timed out '+JSON.stringify(await dbJob(id)))}
try {
  await launch(); context.setDefaultTimeout(20000);
  await context.request.post(base+'/api/auth/setup',{data:{password:'0059'}});
  const token=await(await context.request.post(base+'/api/tokens',{data:{name:'Inline fixture',scope:'write'}})).json();
  const collection=await(await context.request.post(base+'/api/collections',{data:{name:'插画资料'}})).json();
  const setup=await context.newPage();await setup.goto('chrome-extension://'+new URL(worker.url()).host+'/znote/index.html');
  await setup.locator('#server').fill(base);await setup.locator('#token').fill(token.token);await setup.locator('#connect').click();await setup.locator('#connection-status').filter({hasText:'已连接'}).waitFor();await setup.close();
  // Leave native automatic download enabled; library routing must not change it.
  await worker.evaluate(()=>chrome.storage.local.set({xzSetting:{autoStartDownload:true,autoStartDownloadForQuickDownload:true,slowCrawl:false,bmkAfterDL:true,widthTagBoolean:false,restrictBoolean:true}}));
  await offscreenFixtures();
  page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto('https://www.pixiv.net/users/1/artworks');await page.locator('#znote-pixiv-entry').waitFor();await closeNotices();
  const entry=page.locator('#znote-pixiv-entry');await entry.locator('#collection option').filter({hasText:'插画资料'}).waitFor({state:'attached'});await entry.locator('#collection').selectOption(collection.id);
  await entry.locator('#toggle').click();await entry.locator('#tags').fill('参考,整组');await entry.locator('#preferences').click();await entry.locator('#status').filter({hasText:'已记住'}).waitFor();await entry.locator('#toggle').click();
  const tabs=context.pages().length;
  await page.locator('.fixture-card img').hover();await entry.locator('#hover').click();await entry.locator('#group-work').click();
  await entry.locator('#status').filter({hasText:'已排队'}).waitFor();let jobs=await allJobs();const first=jobs.find(j=>j.work?.id==='12345');assert.ok(first);
  await page.locator('.fixture-small img').hover();await page.keyboard.press('z');await entry.locator('#status').filter({hasText:'已排队'}).waitFor();
  await page.waitForTimeout(500);jobs=await allJobs();assert.ok(jobs.some(j=>j.work?.id==='22222'),'Small covers support Z');
  assert.equal(context.pages().length,tabs,'No new task tab');
  await page.close();let failed=await waitJob(first.id,'failed');assert.equal(failed.records.length,2,JSON.stringify(failed));assert.equal(failed.records.filter(r=>r.status==='done').length,1,JSON.stringify(failed.records));
  const second=(await allJobs()).find(j=>j.work?.id==='22222');await waitJob(second.id,'done');console.log('PASS direct + small-cover hotkey, all pages, background continues after source closes');
  failSecond=false;await worker.evaluate(async()=>{const {xzSetting}=await chrome.storage.local.get('xzSetting');await chrome.storage.local.set({xzSetting:{...xzSetting,bmkAfterDL:false}})});page=await context.newPage();await page.goto('https://www.pixiv.net/users/1/artworks');await page.locator('#znote-pixiv-entry').waitFor();await closeNotices();const ui=page.locator('#znote-pixiv-entry');await ui.locator('#toggle').click();
  await ui.locator('[data-job="'+first.id+'"] button').filter({hasText:'重试'}).click();await waitJob(first.id,'done');console.log('retry done');
  for(let i=0;i<100;i++){const bs=await queryDB('bookmark:');if(bs.some(b=>b.state==='failed')&&bs.some(b=>b.state==='done'))break;await page.waitForTimeout(200)}
  const bs=await queryDB('bookmark:');assert.equal(bs.length,2,'One bookmark per work, not per image');assert.equal(bs.filter(b=>b.state==='failed').length,1);assert.equal(bs.filter(b=>b.state==='done').length,1);
  const failedBookmark=bs.find(b=>b.state==='failed');await ui.locator('[data-job="'+failedBookmark.job+'"] button').filter({hasText:'重试'}).click();
  for(let i=0;i<100;i++){if((await queryDB('bookmark:')).every(b=>b.state==='done'))break;await page.waitForTimeout(200)}
  assert.ok((await queryDB('bookmark:')).every(b=>b.state==='done'));assert.equal(bookmarks.length,3);assert.ok(bookmarks.every(b=>b.restrict===1&&b.tags.length===0));
  console.log('PASS native bookmark settings, first successful upload, one per work, failure retry and page-close recovery');
  await ui.locator('#key').fill('Q');await ui.locator('#preferences').click();await ui.locator('#status').filter({hasText:'已记住'}).waitFor();
  const before=(await allJobs()).length;await ui.locator('#tags').fill('z');await page.keyboard.press('q');await page.waitForTimeout(300);assert.equal((await allJobs()).length,before,'Typing never captures');
  await ui.locator('#tags').fill('参考,整组');await ui.locator('#key').fill('Z');await ui.locator('#preferences').click();await ui.locator('#toggle').click();
  // Native author enumeration contains 120 works, while DOM has only two thumbnails.
  await ui.locator('#scope:not([disabled])').waitFor();console.log('scope start');await ui.locator('#scope').click();await ui.locator('#group-work').click();console.log('scope clicked');await closeNotices();
  await ui.locator('#status').filter({hasText:'已排队 120'}).waitFor({timeout:90000});jobs=await allJobs();const bulk=jobs.find(j=>j.total===120);assert.ok(bulk);assert.ok(directoryIDs.every(id=>metaRequests.has(id)));
  assert.equal((await worker.evaluate(()=>chrome.downloads.search({}))).length,0,'Library scope does not invoke native automatic downloads');
  await ui.locator('#native').click();
  const nativeOutput=page.locator('[data-znote-output="settingsPanelSummaryStart"]');await nativeOutput.waitFor();assert.equal(await nativeOutput.evaluate(e=>e.previousElementSibling.id),'settingsPanelSummaryStart');
  await nativeOutput.click();await ui.locator('#group-individual').click();let extra;
  for(let i=0;i<60;i++){extra=(await allJobs()).find(j=>j.id!==bulk.id&&j.total===120&&j.finalized);if(extra)break;await page.waitForTimeout(100)}assert.ok(extra,'Output next to native download queues the existing result');
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('closeSettingsPanel')));
  await ui.locator('#toggle').click();await ui.locator('[data-job="'+extra.id+'"] button').filter({hasText:'停止'}).click();await waitJob(extra.id,'paused');await ui.locator('[data-job="'+extra.id+'"] button').filter({hasText:'移除记录'}).click();await ui.locator('#toggle').click();
  console.log('PASS second output beside original download, existing result reuse, queued cancellation');
  assert.equal(await worker.evaluate(async()=>(await chrome.storage.local.get('xzSetting')).xzSetting.autoStartDownload),true);
  await ui.locator('#toggle').click();await ui.locator('[data-job="'+bulk.id+'"] button').filter({hasText:'停止'}).click();const paused=await waitJob(bulk.id,'paused');assert.ok(paused.records.some(r=>r.status==='pending'));
  await ui.locator('[data-job="'+bulk.id+'"] button').filter({hasText:'重试'}).click();
  await page.close();await waitJob(bulk.id,'done',90000);console.log('PASS native full directory of 120 works, untouched auto-download preference, pause/retry without source tab');
  assert.equal(runtime.db.prepare("SELECT count(*) n FROM items WHERE kind='image'").get().n,123,'Distinct directory originals all exist in the library');
  assert.equal(bookmarks.length,3,'Disabled native auto-bookmark does not bookmark directory');const complete=await dbJob(bulk.id);assert.equal(complete.records.filter(r=>['done','duplicate'].includes(r.status)).length,120);
  for(const row of runtime.db.prepare("SELECT * FROM items WHERE kind='image'").all()){assert.equal(row.collection_id,collection.id);assert.ok(JSON.parse(row.tags).includes('Pixiv'));assert.ok(JSON.parse(row.tags).includes('测试作者'));assert.ok(row.source_url.startsWith('https://www.pixiv.net/artworks/'));}
  page=await context.newPage();await page.goto('https://www.pixiv.net/users/1/artworks');await page.locator('#znote-pixiv-entry').waitFor();await closeNotices();await page.locator('#znote-pixiv-entry #toggle').click();await worker.evaluate(async()=>{const tabs=await chrome.tabs.query({url:'https://www.pixiv.net/*'});for(const t of tabs)await chrome.tabs.sendMessage(t.id,{msg:'dispatchFollowingData',data:[{user:'1',following:['1'],followedUsersInfo:[],total:1}]}).catch(()=>{})});await page.locator('aside a.pbdHighlightFollowing').waitFor();console.log('PASS original followed-author highlighting remains active');await page.waitForTimeout(1500);assert.equal((await worker.evaluate(()=>chrome.downloads.search({}))).length,0,'Returning to a library-captured directory must not restore it as a native download');await page.screenshot({path:resolve('artifacts/pixiv-inline-desktop.png')});
  await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:resolve('artifacts/pixiv-inline-mobile.png')});
  assert.ok(headers.every(h=>!h.authorization));assert.deepEqual(errors,[]);console.log('PASS inline desktop/mobile, correct library/source/tags, no token leaks');
  // Exercise the actual offscreen queue against HTTP failures and a disconnected network.
  await page.setViewportSize({width:1500,height:1000});
  const retryUI=page.locator('#znote-pixiv-entry');
  if(await retryUI.locator('#panel').isVisible())await retryUI.locator('#toggle').click();
  async function enqueueAgain(){
    const previous=new Set((await allJobs()).map(j=>j.id));
    await page.locator('.fixture-card img').hover();await retryUI.locator('#hover').click();await retryUI.locator('#group-work').click();
    for(let i=0;i<100;i++){const job=(await allJobs()).find(j=>!previous.has(j.id));if(job)return job;await page.waitForTimeout(100)}
    throw Error('Missing retry fixture job');
  }
  const countPage=index=>mediaAttempts.get(new URL(original.replace('p0','p'+index)).pathname)||0;
  transientMode='once';mediaAttempts.clear();let retryJob=await enqueueAgain();
  let waiting=await waitJob(retryJob.id,'retry_wait');assert.equal(waiting.records[1].retryCount,1);
  await retryUI.locator('#queue-summary').filter({hasText:'等待自动重试'}).waitFor();
  assert.ok(await retryUI.locator('#panel').isHidden(),'Retry visible without expanding queue');
  await page.screenshot({path:resolve('artifacts/pixiv-retry-waiting.png')});
  // Recreate the offscreen document while the persisted deadline is pending.
  await worker.evaluate(()=>chrome.offscreen.closeDocument());await offscreenFixtures();
  await waitJob(retryJob.id,'done');assert.equal(countPage(0),1);assert.equal(countPage(1),2);
  console.log('PASS automatic 503 retry, persisted deadline after offscreen restart, successful pages skipped');
  transientMode='disconnect';mediaAttempts.clear();retryJob=await enqueueAgain();
  await waitJob(retryJob.id,'retry_wait');await waitJob(retryJob.id,'done');assert.equal(countPage(0),1);assert.equal(countPage(1),2);
  console.log('PASS disconnected request retries automatically');
  transientMode='always';mediaAttempts.clear();retryJob=await enqueueAgain();await waitJob(retryJob.id,'retry_wait');
  await retryUI.locator('#toggle').click();await retryUI.locator('[data-job="'+retryJob.id+'"] button').filter({hasText:'停止'}).click();await waitJob(retryJob.id,'paused');
  const stopped=countPage(1);await page.waitForTimeout(5500);assert.equal(countPage(1),stopped,'Stopped backoff cannot resume itself');
  transientMode='';await retryUI.locator('[data-job="'+retryJob.id+'"] button').filter({hasText:'重试'}).click();await waitJob(retryJob.id,'done');
  assert.equal((await dbJob(retryJob.id)).records[1].retryCount,0,'Manual retry resets persisted record counter');
  await retryUI.locator('#toggle').click();
  failSecond=true;mediaAttempts.clear();retryJob=await enqueueAgain();await waitJob(retryJob.id,'failed');
  await retryUI.locator('#retry-failed').waitFor();assert.ok(await retryUI.locator('#panel').isHidden());
  await page.screenshot({path:resolve('artifacts/pixiv-retry-failure-desktop.png')});
  const touch=await context.newCDPSession(page);await touch.send('Emulation.setTouchEmulationEnabled',{enabled:true});
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:resolve('artifacts/pixiv-retry-failure-mobile.png')});
  const inspect=await retryUI.locator('#show-failed').boundingBox();await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:inspect.x+inspect.width/2,y:inspect.y+inspect.height/2}]});await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await retryUI.locator('#panel').waitFor();await retryUI.locator('#toggle').click();
  failSecond=false;await retryUI.locator('#retry-failed').focus();await page.keyboard.press('Enter');await retryUI.locator('#status').filter({hasText:'已重新排队 1 个失败任务'}).waitFor();await waitJob(retryJob.id,'done');
  assert.equal(countPage(0),1);assert.equal(countPage(1),2);
  assert.equal(runtime.db.prepare("SELECT count(*) n FROM items WHERE kind='image'").get().n,123,'Retries do not duplicate originals');
  console.log('PASS stop waiting, explicit resume, collapsed failure actions, touch inspection and keyboard retry, no duplicate originals');
  await touch.send('Emulation.setTouchEmulationEnabled',{enabled:false});await page.setViewportSize({width:1500,height:1000});
  transientMode='always';permanentFirst=true;mediaAttempts.clear();retryJob=await enqueueAgain();
  for(let attempt=1;attempt<=4;attempt++){
    const state=await waitJob(retryJob.id,'retry_wait');assert.equal(state.records[1].retryCount,attempt);
    // Advance only the fixture's durable deadline so the real runner can exhaust
    // its retry budget without waiting three minutes in the integration test.
    await worker.evaluate(async id=>{
      const db=await new Promise(resolve=>{const q=indexedDB.open('znote-pixiv',1);q.onsuccess=()=>resolve(q.result)});
      await new Promise((resolve,reject)=>{const tx=db.transaction('data','readwrite'),store=tx.objectStore('data');for(const key of ['job:'+id,'summary:'+id]){const q=store.get(key);q.onsuccess=()=>{const value=q.result;value.retryAt=Date.now();store.put(value,key)}}tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)});db.close();
      const port=chrome.runtime.connect({name:'znote-runner'});port.onMessage.addListener(()=>port.disconnect());port.postMessage({wake:true});
    },retryJob.id);
    for(let i=0;i<100;i++){const next=await dbJob(retryJob.id);if(next.state==='failed'||next.records[1].retryCount>attempt)break;await page.waitForTimeout(100)}
  }
  const exhausted=await waitJob(retryJob.id,'failed');assert.equal(exhausted.records[1].retryCount,4);assert.equal(countPage(0),1);assert.equal(countPage(1),5);
  await page.waitForTimeout(1200);assert.equal(countPage(1),5,'No unbounded retry loop');
  console.log('PASS real queue exhausts four retries and never reattempts a permanent failure while retrying another page');
} catch(e){if(page&&!page.isClosed()){await page.screenshot({path:resolve('artifacts/pixiv-inline-failure.png'),timeout:5000});console.log('rects',await page.evaluate(()=>{const h=document.getElementById('znote-pixiv-entry');return {host:h?.getBoundingClientRect().toJSON(),panel:h?.shadowRoot.querySelector('#panel').getBoundingClientRect().toJSON(),hover:h?.shadowRoot.querySelector('#hover').getBoundingClientRect().toJSON(),small:document.querySelector('.fixture-small')?.getBoundingClientRect().toJSON()}}))}throw e;} finally {await context?.close();await runtime.imports.stop();await runtime.backups.stop();await runtime.webhooks.stop();await new Promise(r=>server.close(r));runtime.db.close();}

