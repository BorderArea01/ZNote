// Explicit acceptance against the current Pages queue, collector and library.
// Uses its own invitation, device credential and disposable library only.
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {chromium} from 'playwright';
import {jsonClient} from '../addons/connectors/cloudflare/collector.js';
import {proxyUrl} from '../server/network-proxy.js';
if(!process.argv.includes('--live'))throw Error('Pass --live');
const dir=await mkdtemp(resolve('artifacts/remote-image-live-')),config=JSON.parse(await readFile('data/cloudflare-collector/config.json','utf8')),db=new DatabaseSync('data/znote.sqlite');db.exec('PRAGMA busy_timeout=5000');
const tokenId=randomUUID(),token='zn_'+randomBytes(32).toString('hex'),pin=db.prepare("SELECT value FROM settings WHERE key='password'").get()?.value;
db.prepare('INSERT INTO tokens(id,name,hash,scope,kind,created_at,expires_at) VALUES(?,?,?,?,?,?,?)').run(tokenId,'临时远程单图验收',createHash('sha256').update(token).digest('hex'),'admin','session',new Date().toISOString(),new Date(Date.now()+900000).toISOString());
const local=jsonClient(config.local_origin,token),relay=jsonClient(config.relay_origin,config.connector_secret,{remote:true}),result={realPages:true,realCollector:true};
let context,page,collection,deviceToken,cloudCookie;const cloudIds=[];
const cloud=async(path,method='GET',data)=>{const response=await context.request.fetch(config.relay_origin+path,{method,headers:{Authorization:'Bearer '+deviceToken,'Content-Type':'application/json'},...(data?{data}:{})});const body=await response.json();assert.ok(response.ok(),JSON.stringify(body));return body;};
try{
 collection=await local('/api/collections','POST',{name:'远程单图验收 '+randomUUID().slice(0,6)});
 const code=randomBytes(12).toString('base64url');await relay('/connector/pair','POST',{code});
 const extension=resolve(process.argv.find(v=>v.startsWith('--extension='))?.slice(12)||'addons/browser/clipper');
 context=await chromium.launchPersistentContext(join(dir,'edge'),{channel:'msedge',headless:true,viewport:{width:1280,height:900},...(proxyUrl()?{proxy:{server:proxyUrl(),bypass:'127.0.0.1,localhost'}}:{}),args:['--disable-gpu','--renderer-process-limit=2',`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
 page=await context.newPage();await page.goto(config.relay_origin+'/connect/'+code);await page.getByRole('button',{name:'连接浏览器扩展备用'}).click();await page.locator('#znote-connect-status').filter({hasText:'已连接扩展备用'}).waitFor({timeout:40000});
 const stored=await worker.evaluate(()=>chrome.storage.local.get(['remoteServer','remoteToken']));deviceToken=stored.remoteToken;assert.equal(stored.remoteServer,config.relay_origin);cloudCookie=(await context.cookies()).filter(c=>c.name==='znote_session').map(c=>c.name+'='+c.value).join(';');
 // Remote-only second-PC configuration: it has no developer-machine token.
 await worker.evaluate(id=>chrome.storage.local.set({collection_id:id,saveAction:'save',hover:true,dock:true}),collection.id);
 const source='https://example.com/znote-remote-single-image-acceptance',imageUrl='https://httpbin.org/image/png';
 await context.route(source,route=>route.fulfill({contentType:'text/html; charset=utf-8',body:'<html><title>远程单图验收</title><body><h1>远程单图验收</h1><img id="capture-image" alt="远程单图实际原文件" style="width:320px;height:320px;margin:40px" src="'+imageUrl+'"></body></html>'}));
 await page.goto(source);await page.locator('#capture-image').evaluate(img=>img.decode());await page.locator('#capture-image').hover();await page.locator('[data-znote-overlay] .preview:not(.hidden)').waitFor({timeout:20000});
 const post=context.waitForEvent('request',{predicate:r=>r.method()==='POST'&&r.url()===config.relay_origin+'/api/captures'});await page.keyboard.press('z');
 const request=await post;const payload=request.postDataJSON();assert.deepEqual(payload.remote_image.urls,[imageUrl]);assert.equal(payload.remote_image.source_url,source);assert.equal(payload.collection_id,collection.id);assert.ok(!payload.file&&!payload.browser_html);
 const ref=await worker.evaluate(async()=>{for(let i=0;i<100;i++){const {lastCapture}=await chrome.storage.local.get('lastCapture');if(lastCapture)return lastCapture;await new Promise(r=>setTimeout(r,100));}throw Error('No remote task');});cloudIds.push(ref.id);
 await page.locator('[data-znote-overlay] .preview').filter({hasText:'已加入远程图片采集'}).waitFor();await page.screenshot({path:join(dir,'queued-overlay.png')});
 let job;for(let i=0;i<120;i++){job=await cloud('/api/captures/'+ref.id);if(['completed','failed'].includes(job.status))break;await new Promise(r=>setTimeout(r,1000));}assert.equal(job.status,'completed',job.message);assert.equal(job.message,'图片已入库');
 const row=db.prepare('SELECT id,hash,bytes,source_url,content FROM items WHERE collection_id=? AND deleted_at IS NULL').get(collection.id);assert.ok(row.bytes>100);assert.equal(row.source_url,source);assert.match(row.content,/原图链接：https:\/\/httpbin.org\/image\/png/);
 const media=await fetch(config.local_origin+'/media/'+row.id+'/original',{headers:{Authorization:'Bearer '+token}});assert.ok(media.ok);const original=Buffer.from(await media.arrayBuffer());assert.equal(createHash('sha256').update(original).digest('hex'),row.hash);assert.equal(original.subarray(1,4).toString(),'PNG');
 await context.addCookies([{name:'znote_session',value:token,url:config.local_origin,httpOnly:true,sameSite:'Lax'}]);
 const libraryPage=await context.newPage();await libraryPage.goto(config.local_origin+'/#item/'+row.id);await libraryPage.getByText('远程单图实际原文件',{exact:true}).first().waitFor();await libraryPage.screenshot({path:join(dir,'current-library-ui.png')});result.currentLibraryUi=true;
 const pop=await context.newPage();await pop.goto('chrome-extension://'+new URL(worker.url()).host+'/popup.html');await pop.getByRole('tab',{name:/任务/}).click();await pop.locator('#gallery-status').filter({hasText:'图片已入库'}).waitFor();await pop.screenshot({path:join(dir,'completed-extension.png'),fullPage:true});
 result.overlayActualSaveShortcut=true;result.originalBytes=row.bytes;result.originalSha256=row.hash;result.provenancePreserved=true;result.selectedCollection=true;result.cloudCompleted=true;result.extensionVersion=await worker.evaluate(()=>chrome.runtime.getManifest().version);
}catch(error){result.error=error.message;await page?.screenshot({path:join(dir,'failed.png')}).catch(()=>{});throw error;}
finally{
 try{
  if(context&&deviceToken){if(collection){const all=await cloud('/api/captures');for(const j of all.jobs.filter(j=>j.collection_id===collection.id))if(!cloudIds.includes(j.id))cloudIds.push(j.id);}for(const id of cloudIds)await cloud('/api/captures/'+id,'DELETE',{});await cloud('/api/auth/logout','POST',{});}
  if(context&&cloudCookie)await context.request.post(config.relay_origin+'/api/auth/logout',{headers:{Cookie:cloudCookie,'Content-Type':'application/json'},data:{}});
  if(collection){for(const j of (await local('/api/captures')).jobs.filter(j=>j.collection_id===collection.id)){if(['queued','running'].includes(j.status))throw Error('Acceptance still running; leave intact');await local('/api/captures/'+j.id,'DELETE');}const rows=db.prepare('SELECT id FROM items WHERE collection_id=?').all(collection.id);for(const row of rows)await local('/api/items/'+row.id,'DELETE');if(rows.length){const ids=rows.map(r=>r.id),preview=await local('/api/trash/preview','POST',{collection_id:collection.id,ids});await local('/api/trash/purge','POST',{collection_id:collection.id,ids,revision:preview.revision,confirm:'DELETE'});}await local('/api/collections/'+collection.id,'DELETE');}result.temporaryDataRemoved=true;
 }catch(e){result.cleanupError=e.message;process.exitCode=1;}
 await context?.close();assert.equal(db.prepare("SELECT value FROM settings WHERE key='password'").get()?.value,pin);db.prepare('DELETE FROM tokens WHERE id=?').run(tokenId);db.close();result.pinUnchanged=true;await writeFile(join(dir,'result.json'),JSON.stringify(result,null,2));console.log('Evidence '+dir);
}
