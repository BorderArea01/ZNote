// Read-only real-provider check. Faults affect only these resolver instances,
// never the OS, proxy, existing service or a user's capture queue.
import assert from 'node:assert/strict';
import {getServers} from 'node:dns';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createCaptureHostResolver} from '../server/capture-dns.js';
import {createDohLookup} from '../server/capture-doh.js';
import {createCaptureDocumentFetcher,extractCapturePage} from '../server/capture-page.js';
import {renderDouyinCapture,douyinWork,hasCaptureResources} from '../server/capture-browser.js';
assert.ok(process.argv.includes('--live'));
const dir=await mkdtemp(resolve('artifacts/capture-doh-live-')),before=getServers(),proof={providers:[],pages:[]};
const fail=()=>{throw Object.assign(Error('Isolated DNS failure injection'),{code:'ENOTFOUND'})};
const realDoh=createDohLookup();
try{
 for(const chosen of ['dnspod','cloudflare']){
  const events=[],resolveHost=createCaptureHostResolver({lookup:fail,pause:async()=>{},report:e=>events.push(e),dohLookup:(p,host,options)=>p.name!==chosen?Promise.reject(Object.assign(Error('Isolated provider fault'),{code:'TEST_PROVIDER_FAULT'})):realDoh(p,host,options)});
  const start=Date.now(),addresses=await resolveHost('www.iesdouyin.com',{signal:AbortSignal.timeout(15000)});assert.ok(addresses.length);assert.equal(events.at(-1).resolver,chosen);assert.equal(events.at(-1).code,'OK');proof.providers.push({chosen,events,addresses,ms:Date.now()-start});console.log(JSON.stringify({provider:chosen,recovered:true,ms:Date.now()-start}));
 }
 const ids=process.argv.filter(s=>s.startsWith('--source-job=')).map(s=>s.slice(13));
 if(ids.length){const db=new DatabaseSync('data/znote.sqlite',{readOnly:true});let jobs;try{jobs=JSON.parse(db.prepare("SELECT value FROM settings WHERE key='mobile_captures_v1'").get().value);}finally{db.close()}
  for(const id of ids){const job=jobs.find(j=>j.id===id);assert.ok(job&&job.status==='failed');const events=[],resolveHost=createCaptureHostResolver({lookup:fail,pause:async()=>{},report:e=>events.push(e)}),read=createCaptureDocumentFetcher({resolveHost});
   const start=Date.now();try{const resource=await read(job.source_url,AbortSignal.timeout(30000));let plan=extractCapturePage(resource.buffer.toString('utf8'),resource.url);if(douyinWork(resource.url)&&!hasCaptureResources(plan))plan=await renderDouyinCapture(resource.url,AbortSignal.timeout(35000));assert.ok(hasCaptureResources(plan));const row={id,dnsRecovered:true,events,kind:plan.kind,title:plan.title,images:plan.images?.length||0,videoCandidates:plan.video_urls?.length||0,liveVideos:plan.live_videos?.length||0,ms:Date.now()-start};proof.pages.push(row);console.log(JSON.stringify(row));}
   catch(error){const row={id,events,error:error.message,code:error.code,ms:Date.now()-start};proof.pages.push(row);console.log(JSON.stringify(row));}
  }
 }
}catch(error){proof.error=error.message;throw error;}finally{assert.deepEqual(getServers(),before);proof.systemDnsUnchanged=true;await writeFile(join(dir,'result.json'),JSON.stringify(proof,null,2));console.log('Evidence '+dir);}
