import test from'node:test';import assert from'node:assert/strict';import{createCollector}from'../addons/connectors/cloudflare/collector.js';
const id='11111111-1111-4111-a111-111111111111',claim={id,lease:'first-lease',attempt:0,input:{text:'https://example.com/work',collection_id:'library',image_mode:'group',tags:[]}};
function fixture(){let cloudJob={...claim},localJob,creates=0,retries=0,loseCreate=false,loseSync=false;const inputs=[],updates=[],persisted=[];
 const local=async(path,method,input)=>{if(path==='/api/collections')return[{id:'library',name:'选择的知识库'}];if(path==='/api/captures'&&method==='POST'){inputs.push(input);if(!localJob){creates++;localJob={id:'local',status:'queued',message:'等待保存'};}if(loseCreate){loseCreate=false;throw Error('response lost');}return localJob;}if(path==='/api/captures/local/retry'){retries++;localJob={...localJob,status:'queued',message:'等待重试'};return localJob;}if(path==='/api/captures/local')return localJob;throw Error('unexpected local path '+path);};
 const relay=async(path,method,input)=>{assert.equal(path,'/connector/sync');assert.equal(method,'POST');updates.push(input.updates);if(loseSync){loseSync=false;throw Error('cloud offline');}const job=input.can_claim?cloudJob:null;cloudJob=null;return{job};};
 return{local,relay,persisted,inputs,updates,counts:()=>({creates,retries}),setCloud:j=>{cloudJob=j;},setLocal:j=>{localJob=j;},loseCreate:()=>{loseCreate=true;},loseSync:()=>{loseSync=true;},save:async state=>persisted.push(structuredClone(state))};
}
test('collector resumes after lost submit response with stable request id and selected library, no duplicate local capture',async()=>{
 const f=fixture();f.loseCreate();const first=createCollector(f);await first.step();assert.equal(f.counts().creates,1);
 const resumed=createCollector({...f,state:f.persisted.at(-1)});await resumed.step();assert.equal(f.counts().creates,1);assert.equal(f.inputs.length,2);assert.ok(f.inputs.every(input=>input.request_id==='cf:'+id&&input.collection_id==='library'));
 f.setLocal({id:'local',status:'completed',message:'图片组已入库',title:'原标题'});await resumed.step();assert.equal(resumed.snapshot().jobs.length,0);assert.equal(f.updates.at(-1)[0].status,'completed');
});
test('collector retains completed outbox until cloud acknowledges, and only retries on explicit cloud retry generation',async()=>{
 const f=fixture(),collector=createCollector(f);await collector.step();f.setLocal({id:'local',status:'failed',message:'有图片失败，请重试'});f.loseSync();await assert.rejects(collector.step(),/cloud offline/);assert.equal(collector.snapshot().jobs.length,1);assert.equal(f.counts().retries,0);await collector.step();assert.equal(collector.snapshot().jobs.length,0);
 f.setCloud({...claim,local_id:'local',attempt:1,lease:'retry-lease'});await collector.step();assert.equal(f.counts().retries,1);await collector.step();assert.equal(f.counts().retries,1);
});
test('cloud cannot replace local API paths or forward its own request id and credentials',async()=>{
 const f=fixture();f.setCloud({...claim,input:{...claim.input,request_id:'attacker',local_origin:'http://private.test',token:'secret',browser_html:'unsafe'}});const collector=createCollector(f);await collector.step();assert.deepEqual(Object.keys(f.inputs[0]).sort(),['collection_id','image_mode','request_id','tags','text']);assert.equal(f.inputs[0].request_id,'cf:'+id);
});
