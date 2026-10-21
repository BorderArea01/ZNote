// Explicit real-cloud acceptance. Only creates/deletes its own test collection,
// captures, cloud records and temporary credentials. Never changes the user's PIN.
import assert from'node:assert/strict';import{readFile,mkdtemp,writeFile}from'node:fs/promises';import{resolve,join}from'node:path';import{DatabaseSync}from'node:sqlite';import{randomBytes,randomUUID,createHash}from'node:crypto';import{chromium}from'playwright';
import{jsonClient}from'../addons/connectors/cloudflare/collector.js';import{proxyUrl}from'../server/network-proxy.js';
if(!process.argv.includes('--live'))throw Error('Pass --live');
const config=JSON.parse(await readFile('data/cloudflare-collector/config.json','utf8')),db=new DatabaseSync('data/znote.sqlite');db.exec('PRAGMA busy_timeout=5000');
const tokenId=randomUUID(),token='zn_'+randomBytes(32).toString('hex'),dir=await mkdtemp(resolve('artifacts/cloudflare-inbox-live-')),result={url:config.relay_origin,ui:[]};
const pin=db.prepare("SELECT value FROM settings WHERE key='password'").get()?.value;
db.prepare('INSERT INTO tokens(id,name,hash,scope,kind,created_at,expires_at) VALUES(?,?,?,?,?,?,?)').run(tokenId,'临时远程采集验收',createHash('sha256').update(token).digest('hex'),'admin','session',new Date().toISOString(),new Date(Date.now()+900000).toISOString());
const local=jsonClient(config.local_origin,token),relay=jsonClient(config.relay_origin,config.connector_secret,{remote:true});let browser,page,collection,cloudCookie,mobileToken;const cloudIds=[];
const requestCloud=async(path,method='GET',input,auth={Cookie:cloudCookie})=>{const response=await fetchViaCloud(path,method,input,auth);const value=await response.json();assert.ok(response.ok(),JSON.stringify(value));return value;};
// Browser's request context uses the same real HTTPS proxy as its portal page.
let context;const fetchViaCloud=(path,method,input,headers)=>context.request.fetch(config.relay_origin+path,{method,headers:{'Content-Type':'application/json',...headers},...(input===undefined?{}:{data:input})});
try{
 collection=await local('/api/collections','POST',{name:'远程采集验收 '+randomUUID().slice(0,6)});
 const code=randomBytes(12).toString('base64url');await relay('/connector/pair','POST',{code});
 browser=await chromium.launch({channel:'msedge',headless:true,args:['--disable-gpu','--renderer-process-limit=2'],...(proxyUrl()?{proxy:{server:proxyUrl(),bypass:'127.0.0.1,localhost'}}:{})});context=await browser.newContext({viewport:{width:1200,height:900}});page=await context.newPage();await page.goto(config.relay_origin);await page.locator('#code').fill(code);await page.getByRole('button',{name:'连接设备'}).click();await page.locator('#workspace').waitFor();
 await page.waitForFunction(id=>[...document.querySelector('#library').options].some(o=>o.value===id),collection.id,{timeout:35000});await page.locator('#library').selectOption(collection.id);
 cloudCookie=(await context.cookies()).filter(c=>c.name==='znote_session').map(c=>c.name+'='+c.value).join(';');assert.ok(cloudCookie);
 const source='https://httpbin.org/image/png';await page.locator('#text').fill(source);await page.getByRole('button',{name:'提交采集'}).click();await page.locator('.job').first().waitFor();
 let jobs=await requestCloud('/api/captures');const job=jobs.jobs.find(j=>j.source_url===source&&j.collection_id===collection.id);assert.ok(job);cloudIds.push(job.id);
 let done=job;for(let i=0;i<90&&!['failed','completed'].includes(done.status);i++){await new Promise(r=>setTimeout(r,1000));done=await requestCloud('/api/captures/'+job.id);}assert.equal(done.status,'completed',done.message);
 const rows=db.prepare("SELECT id,bytes,hash,version FROM items WHERE collection_id=? AND kind='image' AND deleted_at IS NULL").all(collection.id);assert.equal(rows.length,1);assert.ok(rows[0].bytes>100);result.savedImage=rows[0].id;
 const original=await fetch(config.local_origin+'/media/'+rows[0].id+'/original',{headers:{Authorization:'Bearer '+token}});assert.ok(original.ok);const bytes=Buffer.from(await original.arrayBuffer());assert.equal(createHash('sha256').update(bytes).digest('hex'),rows[0].hash);
 await page.getByRole('button',{name:'刷新',exact:true}).click();await page.locator('.job[data-state=completed]').waitFor();await page.screenshot({path:join(dir,'desktop-cloud.png'),fullPage:true});result.ui.push({touch:false,realCloud:true,savedInChosenCollection:true});
 mobileToken=await requestCloud('/api/tokens','POST',{name:'临时 Android 协议验收',scope:'write'});
 const native=await requestCloud('/api/captures','POST',{text:source,collection_id:collection.id,image_mode:'group',request_id:'android:live-'+randomUUID()},{Authorization:'Bearer '+mobileToken.token});cloudIds.push(native.id);
 let nativeDone=native;for(let i=0;i<90&&!['completed','failed'].includes(nativeDone.status);i++){await new Promise(r=>setTimeout(r,1000));nativeDone=await requestCloud('/api/captures/'+native.id,'GET',undefined,{Authorization:'Bearer '+mobileToken.token});}assert.equal(nativeDone.status,'completed',nativeDone.message);assert.equal(db.prepare("SELECT count(*) n FROM items WHERE collection_id=? AND kind='image' AND deleted_at IS NULL").get(collection.id).n,2);
 // Paired session and durable device credential share the same personal inbox.
 const touch=await browser.newContext({hasTouch:true,viewport:{width:390,height:844}});await touch.addCookies(await context.cookies());const touchPage=await touch.newPage();await touchPage.goto(config.relay_origin);await touchPage.locator('#workspace').waitFor();await touchPage.getByRole('button',{name:'刷新',exact:true}).tap();await touchPage.locator('.job[data-state=completed]').first().waitFor();const dims=await touchPage.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));assert.ok(dims.scroll<=dims.width);await touchPage.screenshot({path:join(dir,'touch-cloud.png'),fullPage:true});result.ui.push({touch:true,realCloud:true,androidProtocol:true,noOverflow:true});await touch.close();
 result.actualCloudToLocalImages=2;result.actualFilesVerified=true;result.nativeDeviceToken=true;
}catch(error){result.error=error.message;if(page&&!page.isClosed())await page.screenshot({path:join(dir,'failed.png'),fullPage:true}).catch(()=>{});throw error;}
finally{
 try{
  if(context){cloudCookie||=(await context.cookies()).filter(c=>c.name==='znote_session').map(c=>c.name+'='+c.value).join(';');for(const id of cloudIds)await requestCloud('/api/captures/'+id,'DELETE',{});if(mobileToken)await requestCloud('/api/auth/logout','POST',{}, {Authorization:'Bearer '+mobileToken.token});if(cloudCookie)await requestCloud('/api/auth/logout','POST',{});}
  if(collection){const captures=await local('/api/captures');for(const job of captures.jobs.filter(j=>j.collection_id===collection.id)){if(['queued','running'].includes(job.status))throw Error('Test capture still running; leave its data intact');await local('/api/captures/'+job.id,'DELETE');}
   const rows=db.prepare('SELECT id FROM items WHERE collection_id=?').all(collection.id);for(const row of rows)await local('/api/items/'+row.id,'DELETE');if(rows.length){const ids=rows.map(r=>r.id),preview=await local('/api/trash/preview','POST',{collection_id:collection.id,ids});await local('/api/trash/purge','POST',{collection_id:collection.id,ids,revision:preview.revision,confirm:'DELETE'});}await local('/api/collections/'+collection.id,'DELETE');}
  result.temporaryDataRemoved=true;
 }catch(e){result.cleanupError=e.message;process.exitCode=1;}
 await browser?.close();assert.equal(db.prepare("SELECT value FROM settings WHERE key='password'").get()?.value,pin);db.prepare('DELETE FROM tokens WHERE id=?').run(tokenId);db.close();result.pinUnchanged=true;await writeFile(join(dir,'result.json'),JSON.stringify(result,null,2));console.log('Evidence '+dir);
}
