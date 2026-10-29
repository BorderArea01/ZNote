// Authorized retry of the specified existing cloud tasks. Preserves their IDs,
// destinations, resulting media and source; removes only its own temporary auth.
import assert from 'node:assert/strict';
import {request as httpsRequest} from 'node:https';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {chromium} from 'playwright';
import {jsonClient} from '../addons/connectors/cloudflare/collector.js';
import {proxyAgent,proxyUrl} from '../server/network-proxy.js';
assert.ok(process.argv.includes('--live'));
const ids=process.argv.filter(s=>s.startsWith('--source-job=')).map(s=>s.slice(13));assert.ok(ids.length);
const dir=await mkdtemp(resolve('artifacts/capture-doh-recovery-')),config=JSON.parse(await readFile('data/cloudflare-collector/config.json','utf8')),db=new DatabaseSync('data/znote.sqlite');db.exec('PRAGMA busy_timeout=5000');
const pin=db.prepare("SELECT value FROM settings WHERE key='password'").get()?.value,baseline=JSON.parse(db.prepare("SELECT value FROM settings WHERE key='mobile_captures_v1'").get().value),report={jobs:[],ui:[]};
const selected=ids.map(id=>{const job=baseline.find(j=>j.id===id);assert.ok(job&&/^cf:[a-f0-9-]{36}$/.test(job.request_id));assert.ok(['failed','completed'].includes(job.status));return job});
const tokenId=randomUUID(),token='zn_'+randomBytes(32).toString('hex');db.prepare('INSERT INTO tokens VALUES(?,?,?,?,?,?,?)').run(tokenId,'DoH 原任务验收临时授权',createHash('sha256').update(token).digest('hex'),'admin','session',new Date().toISOString(),new Date(Date.now()+1800000).toISOString());
let cookie,context,browser;const completed=[];
const local=async(path,method='GET',body)=>{const response=await fetch(config.local_origin+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(30000)});const value=response.status===204?null:await response.json();assert.ok(response.ok,JSON.stringify(value));return value};
const cloud=(path,method='GET',input)=>new Promise((resolve,reject)=>{
 const body=input===undefined?null:Buffer.from(JSON.stringify(input));const req=httpsRequest(config.relay_origin+path,{method,agent:proxyAgent(),signal:AbortSignal.timeout(20000),headers:{Origin:config.relay_origin,...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json','Content-Length':body.length}:{})}},res=>{
  const chunks=[];let size=0;res.on('data',chunk=>{size+=chunk.length;if(size>2*1024*1024){res.destroy();reject(Error('Oversized cloud response'))}else chunks.push(chunk)});res.on('error',reject);res.on('end',()=>{try{const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));assert.ok(res.statusCode>=200&&res.statusCode<300,JSON.stringify(value));const session=res.headers['set-cookie']?.find(c=>c.startsWith('znote_session='));if(session)cookie=session.split(';')[0];resolve(value);}catch(error){reject(error)}});
 });req.on('error',reject);req.end(body);
});
try{
 const code=randomBytes(12).toString('base64url');await jsonClient(config.relay_origin,config.connector_secret,{remote:true})('/connector/pair','POST',{code});await cloud('/api/auth/login','POST',{password:code});assert.ok(cookie);
 for(const original of selected){
  const cloudId=original.request_id.slice(3);let cloudJob=await cloud('/api/captures/'+cloudId);
  if(original.status!=='completed'){assert.equal(cloudJob.status,'failed');await cloud('/api/captures/'+cloudId+'/retry','POST',{});}
  let message;
  for(let attempt=0;attempt<240;attempt++){
   cloudJob=await cloud('/api/captures/'+cloudId);if(cloudJob.message!==message){message=cloudJob.message;console.log(JSON.stringify({id:original.id,status:cloudJob.status,message}));}
   if(['completed','failed'].includes(cloudJob.status))break;await new Promise(r=>setTimeout(r,1000));
  }
  const actual=await local('/api/captures/'+original.id);assert.equal(actual.id,original.id);assert.equal(actual.collection_id,original.input.collection_id);
  const entry={id:original.id,cloudId,status:cloudJob.status,localStatus:actual.status,message:actual.message};report.jobs.push(entry);
  if(cloudJob.status!=='completed'){process.exitCode=1;continue;}
  assert.equal(actual.status,'completed');const item=await local('/api/items/'+actual.item_id);assert.equal(item.kind,'video');assert.ok(item.bytes>1000&&item.duration>0);assert.ok(item.source_url);assert.equal(item.collection_id,original.input.collection_id);
  const response=await fetch(config.local_origin+item.url,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(60000)});assert.ok(response.ok);let bytes=0;const hash=createHash('sha256');for await(const chunk of response.body){bytes+=chunk.length;hash.update(chunk)}assert.equal(bytes,item.bytes);assert.equal(hash.digest('hex'),db.prepare('SELECT hash FROM items WHERE id=?').get(item.id).hash);
  const range=await fetch(config.local_origin+item.url,{headers:{Authorization:'Bearer '+token,Range:'bytes=0-1023'}});assert.equal(range.status,206);assert.equal((await range.arrayBuffer()).byteLength,1024);
  const same=JSON.parse(db.prepare("SELECT value FROM settings WHERE key='mobile_captures_v1'").get().value).filter(j=>j.request_id===original.request_id);assert.equal(same.length,1);assert.equal(same[0].id,original.id);
  Object.assign(entry,{title:item.title,itemId:item.id,bytes,duration:item.duration,sourcePreserved:true,hashVerified:true,range:true,originalTaskRetained:true});completed.push(item);
 }
 // Playback/UI runs only after the server has finished its anonymous parsing
 // browsers. One context at a time; no writes to the user's playback history.
 browser=await chromium.launch({channel:'msedge',headless:true,args:['--mute-audio','--disable-gpu','--renderer-process-limit=2'],...(proxyUrl()?{proxy:{server:proxyUrl(),bypass:'127.0.0.1,localhost'}}:{})});
 for(const touch of [false,true]){
  context=await browser.newContext({hasTouch:touch,viewport:{width:touch?390:1280,height:900}});
  await context.addCookies([{name:'znote_session',value:token,url:config.local_origin,httpOnly:true,sameSite:'Lax'},{name:'znote_session',value:cookie.slice('znote_session='.length),url:config.relay_origin,httpOnly:true,secure:true,sameSite:'Strict'}]);
  await context.route(config.local_origin+'/api/**',async route=>{const req=route.request();if(['GET','HEAD'].includes(req.method()))return route.continue();if(new URL(req.url()).pathname==='/api/video-progress'){const input=req.postDataJSON(),state=await local('/api/video-progress?collection='+(input.collection_id||'unfiled'));return route.fulfill({json:state})}throw Error('Unexpected UI write '+new URL(req.url()).pathname)});
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  for(const item of completed){
   await page.goto(config.local_origin+'/#item/'+item.id);const video=page.locator('[role=dialog] video');await video.waitFor();await page.waitForFunction(()=>document.querySelector('[role=dialog] video')?.readyState>=2);
   await video.evaluate(async el=>{el.muted=true;await el.play()});await page.waitForFunction(()=>document.querySelector('[role=dialog] video')?.currentTime>.25);const duration=await video.evaluate(el=>{el.pause();return el.duration});assert.ok(duration>0);
   const seek=Math.min(duration/2,3);await video.evaluate((el,time)=>{el.currentTime=time},seek);await page.waitForFunction(t=>Math.abs(document.querySelector('[role=dialog] video').currentTime-t)<.2,seek);
   await page.screenshot({path:join(dir,(touch?'touch':'desktop')+'-'+item.id+'.png'),mask:[page.locator('video,img')]});await page.keyboard.press('Escape');await video.waitFor({state:'hidden'});report.ui.push({touch,itemId:item.id,decoded:true,played:true,seek:true,closed:true,duration});
  }
  await page.goto(config.relay_origin);await page.locator('#workspace').waitFor();for(const item of report.jobs){const original=selected.find(j=>j.id===item.id);const row=page.locator('.job').filter({has:page.locator('a[href='+JSON.stringify(original.source_url)+']')});await row.waitFor();assert.equal(await row.getAttribute('data-state'),item.status);}
  await page.screenshot({path:join(dir,(touch?'touch':'desktop')+'-cloud-status.png')});assert.deepEqual(errors,[]);await context.close();context=null;
 }
}catch(error){report.error=error.message;throw error;}finally{
 await context?.close();await browser?.close();if(cookie)try{await cloud('/api/auth/logout','POST',{})}catch(error){report.cleanupError=error.message;process.exitCode=1;}
 assert.equal(db.prepare("SELECT value FROM settings WHERE key='password'").get()?.value,pin);report.pinUnchanged=true;db.prepare('DELETE FROM tokens WHERE id=?').run(tokenId);db.close();report.temporaryLocalAuthRemoved=true;await writeFile(join(dir,'result.json'),JSON.stringify(report,null,2));console.log('Evidence '+dir);
}
