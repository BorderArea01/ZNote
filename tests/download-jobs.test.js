import test from 'node:test';
import assert from 'node:assert/strict';
import {downloadJobs,filterDownloads,downloadFailed,retryDownloads,downloadSource} from '../src/download-jobs.js';
import {TaskStore} from '../src/task-store.js';
const now=Date.parse('2026-11-04T00:00:00Z');
const job=(id,more={})=>({id:'capture:'+id,remote_id:id,type:'capture',status:'failed',collection_id:'library',created_at:'2026-11-03T00:00:00Z',title:id,...more});
test('download history separates queues, library/date scope and music failure without reclassifying active retries',()=>{
 const rows=downloadJobs({captures:[{...job('same'),id:'same'},{...job('music'),id:'music',status:'completed',bgm_status:'failed'},{...job('pending'),id:'pending',status:'queued',bgm_status:'failed'},{...job('old'),id:'old',created_at:'2026-10-01'},{...job('unfiled'),id:'unfiled',collection_id:null}],imports:[{...job('same'),id:'same',status:'completed'},{...job('retired'),id:'retired',retried_as:'new'}]});
 assert.equal(new Set(rows.map(r=>r.id)).size,7);
 assert.equal(filterDownloads(rows,{scope:'library',days:'7',status:'failed',now}).length,2);
 assert.deepEqual(filterDownloads(rows,{scope:'unfiled',days:'all',now}).map(j=>j.remote_id),['unfiled']);
 assert.equal(filterDownloads(rows,{scope:'all',days:'all',now}).length,7);
 assert.equal(downloadFailed(rows.find(j=>j.remote_id==='pending')),false);
 assert.equal(rows.find(j=>j.remote_id==='retired').state,'resubmitted');
 assert.equal(downloadSource('javascript:alert(1)'),null);assert.equal(downloadSource('https://secret@example.com'),null);assert.equal(downloadSource('https://example.com/path').host,'example.com');
});
test('retry submits original IDs once, skips state changes and preserves target scope',async()=>{
 const a=job('a'),b=job('b'),c=job('c'),calls=[];
 const result=await retryDownloads([a,a,b,c],{request:async(path,options)=>{calls.push([path,options?.method||'GET']);if(options)return{status:'queued'};return{collection_id:path.endsWith('/c')?'elsewhere':'library',status:path.endsWith('/b')?'running':'failed'}}});
 assert.equal(result.submitted,1);assert.equal(result.skipped,1);assert.equal(result.errors.length,1);assert.equal(result.remaining,0);
 assert.deepEqual(calls.filter(c=>c[1]==='POST'),[['/api/captures/a/retry','POST']]);
});
test('bulk retry stops at queue capacity/auth failures and does not automatically repeat uncertain writes',async()=>{
 for(const status of[401,403,429]){const writes=[];const r=await retryDownloads([job('a'),job('b'),job('c')],{request:async(p,o)=>{if(!o)return{status:'failed',collection_id:'library'};writes.push(p);throw Object.assign(Error('blocked'),{status})}});assert.equal(r.remaining,2);assert.equal(r.submitted,0);assert.equal(writes.length,1);}
 let posts=0;const r=await retryDownloads([job('lost')],{request:async(p,o)=>{if(!o)return{status:'failed',collection_id:'library'};posts++;throw new TypeError('network response lost')}});assert.equal(posts,1);assert.equal(r.submitted,0);assert.equal(r.errors.length,1);
});
test('cancel on close stops later submissions; a failed entry does not block other eligible records',async()=>{
 let open=true;const r=await retryDownloads([job('a'),job('b')],{request:async(p,o)=>{if(!o)return{status:'failed',collection_id:'library'};open=false;return{status:'queued'}},shouldContinue:()=>open});assert.equal(r.submitted,1);assert.equal(r.remaining,1);
 const next=await retryDownloads([job('gone'),job('ok',{type:'import',id:'import:ok'})],{request:async(p,o)=>{if(p.includes('gone'))throw Object.assign(Error('removed'),{status:404});return{status:o?'queued':'failed',collection_id:'library'}}});assert.equal(next.submitted,1);assert.equal(next.errors.length,1);
});
test('capture completion signals gallery refresh once and preserves existing import polling callers',()=>{
 const s=new TaskStore();s.setRemote({imports:[],captures:[{id:'c',status:'running'}],exports:[]});assert.equal(s.changes,0);s.setRemote({imports:[],captures:[{id:'c',status:'completed'}]});assert.equal(s.changes,1);s.setRemote({imports:[]});assert.equal(s.remote.captures.length,1);assert.equal(s.changes,1);s.dispose();
});

test('old tasks retried or completed recently are included by their latest activity',()=>{const rows=downloadJobs({captures:[{id:'old',created_at:'2020-01-01',last_attempt_at:'2026-11-03',status:'running'},{id:'done',created_at:'2020-01-01',finished_at:'2026-11-04',status:'completed'}]});assert.deepEqual(filterDownloads(rows,{now,days:'7'}).map(j=>j.remote_id),['done','old']);});

test('record removal uses dedicated routes, never cancels active work or deletes content',async()=>{
 const {removeDownloads}=await import('../src/download-jobs.js'),calls=[];
 const rows=[job('failed'),job('done',{status:'completed'}),job('active',{status:'running'}),job('queued',{status:'queued'}),job('saving',{status:'saving'}),job('video',{id:'import:video',type:'import',status:'cancelled'})];
 const r=await removeDownloads(rows,{request:async(p,o)=>{calls.push([p,o?.method||'GET']);return o?{removed:true}:{status:p.endsWith('done')?'completed':p.endsWith('video')?'cancelled':'failed',collection_id:'library'}}});
 assert.equal(r.removed,3);assert.deepEqual(calls.filter(c=>c[1]==='DELETE').map(c=>c[0]),['/api/captures/failed','/api/captures/done','/api/imports/video/record']);
});
test('removal rechecks target/state, handles already removed records and continues after a per-item error',async()=>{
 const {removeDownloads}=await import('../src/download-jobs.js'),deletes=[];
 const r=await removeDownloads(['busy','moved','gone','broken','ok'].map(id=>job(id)),{request:async(p,o)=>{if(p.endsWith('gone'))throw Object.assign(Error('gone'),{status:404});if(p.endsWith('broken'))throw Object.assign(Error('offline'),{status:503});if(o){deletes.push(p);return{removed:true}}return{status:p.endsWith('busy')?'running':'failed',collection_id:p.endsWith('moved')?'another':'library'}}});
 assert.equal(r.removed,1);assert.equal(r.skipped,2);assert.equal(r.errors.length,2);assert.deepEqual(deletes,['/api/captures/ok']);
});
test('removal stops after close or authorization failure without replaying uncertain DELETE writes',async()=>{
 const {removeDownloads}=await import('../src/download-jobs.js');let open=true,count=0;
 const r=await removeDownloads([job('a'),job('b')],{shouldContinue:()=>open,request:async(p,o)=>{if(o){open=false;count++;return{removed:true}}return{status:'failed',collection_id:'library'}}});assert.equal(r.remaining,1);assert.equal(count,1);
 const denied=await removeDownloads([job('a'),job('b')],{request:async()=>{throw Object.assign(Error('denied'),{status:403})}});assert.equal(denied.remaining,1);assert.equal(denied.errors.length,1);
});
