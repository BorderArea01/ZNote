// Opt-in current-instance verification. Uses only its own temporary library,
// token, jobs and items; never changes the user's PIN or existing groups.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {chromium} from 'playwright';
if(!process.argv.includes('--live'))throw Error('Pass --live to verify the current service');
const base=process.env.ZNOTE_BASE||'http://127.0.0.1:3741';
const extensionPath=resolve(process.env.ZNOTE_CLIPPER_DIR||'addons/browser/clipper');
const source='https://tieba.baidu.com/p/11090769629?share=9105&fr=sharewise&see_lz=0&pn=4';
const canonical='https://tieba.baidu.com/p/11090769629';
const dir=await mkdtemp(resolve('artifacts/tieba-live-'));
const db=new DatabaseSync('data/znote.sqlite');db.exec('PRAGMA busy_timeout=5000');
const tokenId=randomUUID(),token='zn_'+randomBytes(32).toString('hex'),headers={Authorization:'Bearer '+token};
const extensionTokenId=randomUUID(),extensionToken='zn_'+randomBytes(32).toString('hex');
const pin=db.prepare("SELECT value FROM settings WHERE key='password'").get()?.value;
const result={base,verifiedAt:new Date().toISOString(),ui:[],temporaryDataRemoved:false};
const collections=[];let context,page;
db.prepare('INSERT INTO tokens(id,name,hash,scope,kind,created_at,expires_at) VALUES(?,?,?,?,?,?,?)').run(tokenId,'临时贴吧实际实例验收',createHash('sha256').update(token).digest('hex'),'admin','session',new Date().toISOString(),new Date(Date.now()+1800000).toISOString());
db.prepare('INSERT INTO tokens(id,name,hash,scope,kind,created_at,expires_at) VALUES(?,?,?,?,?,?,?)').run(extensionTokenId,'临时贴吧扩展验收',createHash('sha256').update(extensionToken).digest('hex'),'write','api',new Date().toISOString(),new Date(Date.now()+1800000).toISOString());
const api=async(path,method='GET',body)=>{
  const response=await fetch(base+path,{method,headers:{...headers,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  assert.ok(response.ok,`HTTP ${response.status}: ${await response.clone().text()}`);
  return response.status===204?null:response.json();
};
const rowsFor=async collection=>(await api('/api/items?collection='+collection+'&grouped=false&limit=50')).items;
const jobsFor=async collection=>(await api('/api/captures')).jobs.filter(job=>job.collection_id===collection);
const waitJob=async id=>{
  const until=Date.now()+180000;let job;
  do{
    job=await api('/api/captures/'+id);
    if(!['queued','running'].includes(job.status))break;
    await new Promise(resolve=>setTimeout(resolve,250));
  }while(Date.now()<until);
  assert.equal(job.status,'completed',job.message);return job;
};
const assertGroup=async collection=>{
  const rows=(await rowsFor(collection)).sort((a,b)=>a.group_index-b.group_index);
  assert.equal(rows.length,3);assert.ok(rows.every(row=>row.kind==='image'&&row.collection_id===collection&&row.source_url===canonical));
  assert.deepEqual(rows.map(row=>row.group_index),[0,1,2]);assert.equal(new Set(rows.map(row=>row.group_key)).size,1);assert.ok(rows[0].group_key?.startsWith('capture:'));
  for(const row of rows){const detail=await api('/api/items/'+row.id);assert.ok(detail.content.includes('楼主 · 1 楼'),'Missing OP first floor');assert.ok(detail.content.includes('楼主 · 11 楼'),'Missing OP later floor');assert.ok(detail.content.includes('来源：'+canonical),'Missing source');assert.ok(detail.content.startsWith('作者：'),'Missing author');}
  const folded=await api('/api/items?collection='+collection+'&grouped=true&limit=50');assert.equal(folded.items.length,1);assert.equal(folded.items[0].group_count,3);
  return rows;
};
try{
  result.health=await api('/api/health');
  const html=await(await fetch(base)).text();result.build=html.match(/\/assets\/index-[^" ]+\.js/)?.[0];assert.ok(result.build);
  const library=await api('/api/collections','POST',{name:'临时贴吧验收',color:'#14b8a6'});collections.push(library.id);
  const before=(await rowsFor(library.id)).length;
  const {plan}=await api('/api/captures/resolve','POST',{text:source});assert.equal(plan.images.length,3);assert.equal(plan.default_image_mode,'group');assert.equal(plan.url,canonical);
  assert.equal((await rowsFor(library.id)).length,before);assert.equal((await jobsFor(library.id)).length,0);
  const input={text:source,collection_id:library.id,request_id:'tieba-live:'+randomUUID()};
  const job=await api('/api/captures','POST',input);await waitJob(job.id);const rows=await assertGroup(library.id);
  const replay=await api('/api/captures','POST',input);assert.equal(replay.id,job.id);assert.equal((await rowsFor(library.id)).length,3);
  result.capture={members:3,cards:1,remarks:true,author:true,source:true,resolveReadOnly:true,idempotentReplay:true,originals:[]};
  for(const [index,row] of rows.entries()){
    const original=await fetch(plan.images[index],{signal:AbortSignal.timeout(20000)});assert.equal(original.status,200);
    const expected=Buffer.from(await original.arrayBuffer()),saved=await fetch(base+row.url,{headers});assert.equal(saved.status,200);
    const actual=Buffer.from(await saved.arrayBuffer());assert.deepEqual(actual,expected);assert.equal(actual.length,row.bytes);
    result.capture.originals.push({bytes:actual.length,width:row.width,height:row.height,hash:createHash('sha256').update(actual).digest('hex')});
  }
  console.log('PASS actual service: one group, three originals, OP remarks, source, readonly resolve and replay');
  for(const touch of [false,true]){
    context=await chromium.launchPersistentContext(join(dir,touch?'touch-profile':'desktop-profile'),{channel:'msedge',headless:true,hasTouch:touch,viewport:{width:touch?390:1280,height:touch?844:900},args:['--mute-audio','--disable-gpu','--renderer-process-limit=2',`--disable-extensions-except=${extensionPath}`,`--load-extension=${extensionPath}`]});
    context.setDefaultTimeout(20000);await context.addCookies([{name:'znote_session',value:token,url:base,httpOnly:true,sameSite:'Strict'}]);
    // Match a connected user's extension state before visiting the library;
    // a fresh profile otherwise points at localhost rather than 127.0.0.1.
    const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
    await worker.evaluate(config=>chrome.storage.local.set(config),{server:base,token:extensionToken,collection_id:library.id,saveAction:'save',blockedSites:[]});
    const errors=[];context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
    page=await context.newPage();const click=locator=>touch?locator.tap():locator.click();
    await page.goto(base+'/?item='+rows[0].id);let detail=page.getByRole('dialog',{name:'图片详情',exact:true});await detail.waitFor();
    const strip=detail.getByRole('navigation',{name:'图片缩略图列'});await strip.getByRole('option',{name:'查看第 3 张图片'}).waitFor();assert.equal(await strip.getByRole('option').count(),3);
    await detail.locator('.media-description').getByText('作者：'+plan.author,{exact:false}).waitFor();assert.ok((await detail.locator('.media-description').innerText()).includes('楼主 · 11 楼'));
    await page.waitForFunction(()=>[...document.querySelectorAll('.image-stage img,.gallery-strip img')].every(img=>img.complete&&img.naturalWidth>0));
    assert.ok(await detail.getByRole('button',{name:'← 上一张',exact:true}).isDisabled());
    await click(strip.getByRole('option',{name:'查看第 3 张图片'}));await strip.getByRole('option',{name:'查看第 3 张图片',selected:true}).waitFor();assert.ok(await detail.getByRole('button',{name:'下一张 →',exact:true}).isDisabled());
    await click(strip.getByRole('option',{name:'查看第 1 张图片'}));await strip.getByRole('option',{name:'查看第 1 张图片',selected:true}).waitFor();
    const hint=detail.getByRole('button',{name:'翻图快捷键说明',exact:true});await click(hint);await page.getByRole('tooltip').waitFor();await page.waitForTimeout(100);assert.ok(await page.getByRole('tooltip').isVisible());await page.keyboard.press('Escape');
    await click(detail.getByRole('button',{name:'全屏查看图片',exact:true}));const zoom=page.getByRole('dialog',{name:'展开图片',exact:true});await zoom.waitFor();
    await page.waitForFunction(()=>{const img=document.querySelector('.zoom-viewer img');return img?.complete&&img.naturalWidth>0;});
    const scale=zoom.getByLabel('缩放比例');const beforeScale=await scale.innerText();await click(zoom.getByRole('button',{name:'放大',exact:true}));await page.waitForFunction(value=>document.querySelector('.zoom-tools output')?.textContent!==value,beforeScale);assert.notEqual(await scale.innerText(),beforeScale);await click(zoom.getByRole('button',{name:'重置缩放',exact:true}));
    await click(zoom.getByRole('button',{name:'下一张图片',exact:true}));await zoom.getByRole('status').filter({hasText:'第 2'}).waitFor();
    await click(zoom.getByRole('button',{name:'退出全屏',exact:true}));await zoom.waitFor({state:'hidden'});
    await click(detail.getByRole('button',{name:'关闭窗口',exact:true}));await detail.waitFor({state:'hidden'});
    await page.getByRole('button',{name:'打开 '+plan.title,exact:true}).waitFor();assert.equal(await page.locator('.item-card').count(),1);
    await page.screenshot({path:join(dir,`${touch?'touch':'desktop'}-card.png`),mask:[page.locator('img')]});
    // The failure affects only this browser's temporary item, never the server
    // or another user's media requests.
    let failImage=true;await page.route('**/media/'+rows[0].id+'/original',route=>failImage?route.fulfill({status:503,body:'temporary verification failure'}):route.continue());
    await page.goto(base+'/?item='+rows[0].id);detail=page.getByRole('dialog',{name:'图片详情',exact:true});await detail.waitFor();await click(detail.getByRole('button',{name:'全屏查看图片',exact:true}));
    await zoom.getByRole('alert').filter({hasText:'图片加载失败'}).waitFor();failImage=false;await click(zoom.getByRole('button',{name:'重试图片',exact:true}));await zoom.getByRole('alert').waitFor({state:'hidden'});await page.waitForFunction(()=>document.querySelector('.zoom-viewer img')?.naturalWidth>0);
    await click(zoom.getByRole('button',{name:'退出全屏',exact:true}));await page.screenshot({path:join(dir,`${touch?'touch':'desktop'}-detail.png`),mask:[page.locator('img')]});
    await detail.locator('.media-description').scrollIntoViewIfNeeded();
    await page.screenshot({path:join(dir,`${touch?'touch':'desktop'}-remarks.png`),mask:[page.locator('img')]});
    await click(detail.getByRole('button',{name:'关闭窗口',exact:true}));
    result.ui.push({touch,thumbnailMembers:3,oneFoldedCard:true,remarksVisible:true,firstAndLastBoundary:true,zoomAndPaging:true,helpAndClose:true,imageFailureRecovery:true});
    if(!touch){
      const extensionLibrary=await api('/api/collections','POST',{name:'临时贴吧扩展验收',color:'#14b8a6'});collections.push(extensionLibrary.id);
      await worker.evaluate(config=>chrome.storage.local.set(config),{server:base,token:extensionToken,collection_id:extensionLibrary.id,saveAction:'save',blockedSites:[]});
      const tab=await context.newPage();await tab.goto(canonical,{waitUntil:'domcontentloaded',timeout:30000});
      const save=tab.getByRole('button',{name:'采集当前作品',exact:true});await save.waitFor();await save.click();
      await tab.waitForFunction(()=>{const root=document.querySelector('[data-znote-page-tools]')?.shadowRoot;return root?.textContent.includes('图片组已入库，正文已保存在备注')||root?.querySelector('.znote-work-button')?.textContent==='重试采集';},null,{timeout:60000});
      assert.ok(await tab.getByText('图片组已入库，正文已保存在备注',{exact:false}).isVisible(),await save.innerText());await assertGroup(extensionLibrary.id);
      await tab.screenshot({path:join(dir,'installed-extension-tieba.png'),mask:[tab.locator('img')]});
      result.extension={installedDirectory:extensionPath,version:JSON.parse(await readFile(join(extensionPath,'manifest.json'),'utf8')).version,actualSite:tab.url(),currentWorkButton:true,successFeedback:true,members:3};await tab.close();
    }
    assert.deepEqual(errors,[]);await context.close();context=null;page=null;
    console.log(`PASS ${touch?'touch':'desktop'}: thumbnails, remarks, boundaries, zoom, close, failure recovery`);
  }
}catch(error){
  result.error=error.message;
  if(page)await page.screenshot({path:join(dir,'failed.png'),mask:[page.locator('img')]}).catch(()=>{});
  throw error;
}finally{
  if(context)await context.close();
  try{
    for(const collection of collections){
      for(const job of await jobsFor(collection)){
        if(['queued','running'].includes(job.status))await waitJob(job.id);
        await api('/api/captures/'+job.id,'DELETE');
      }
      const rows=await rowsFor(collection);
      for(const row of rows)await api('/api/items/'+row.id,'DELETE');
      if(rows.length){const ids=rows.map(row=>row.id),preview=await api('/api/trash/preview','POST',{collection_id:collection,ids});await api('/api/trash/purge','POST',{collection_id:collection,ids,revision:preview.revision,confirm:'DELETE'});}
      await api('/api/collections/'+collection,'DELETE');
      assert.equal(db.prepare('SELECT count(*) n FROM items WHERE collection_id=?').get(collection).n,0);
    }
    result.temporaryDataRemoved=true;
    assert.equal(db.prepare("SELECT value FROM settings WHERE key='password'").get()?.value,pin);result.pinUnchanged=true;
  }catch(error){result.cleanupError=error.message;process.exitCode=1;}
  db.prepare('DELETE FROM tokens WHERE id IN (?,?)').run(tokenId,extensionTokenId);db.close();
  await writeFile(join(dir,'result.json'),JSON.stringify(result,null,2));console.log('Evidence: '+dir);
}
