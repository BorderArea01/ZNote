import test from 'node:test';
import assert from 'node:assert/strict';
import {TaskStore} from '../src/task-store.js';
const tick=()=>new Promise(r=>setTimeout(r,0));
test('page task queue bounds each lane, retains results and retries original operations',async()=>{
  const store=new TaskStore({limit:5,history:2});let release,active=0,peak=0,calls=0;
  const gate=new Promise(r=>release=r);
  const [one,two,other]=store.enqueue([{type:'upload',collection_id:'a',title:'one',run:async({update})=>{active++;peak=Math.max(peak,active);update({progress:80});await gate;active--;return{id:'one',content:'private-result'};}},{type:'upload',collection_id:'b',title:'two',run:async()=>{calls++;active++;peak=Math.max(peak,active);active--;if(calls===1)throw Error('disconnected');return{id:'two'};}},{type:'export',run:async()=>({download:true})}]);
  await tick();assert.equal(store.getSnapshot().jobs.find(j=>j.id===two.id).status,'queued');assert.equal((await other.promise).ok,true);release();assert.equal((await one.promise).value.id,'one');assert.equal((await two.promise).ok,false);assert.equal(peak,1);assert.equal(store.getSnapshot().jobs.find(j=>j.id===two.id).collection_id,'b');assert.equal((await store.retry(two.id)).value.id,'two');assert.equal(store.getSnapshot().changes,2);assert.equal(store.getSnapshot().jobs.length,2);assert.ok(!JSON.stringify(store.getSnapshot()).includes('private-result'));assert.equal(store.jobs.get(two.id).runner,null);store.dispose();
});
test('queued cancellation never invokes work, running cancellation settles before retry, processing cannot be cancelled',async()=>{
  const store=new TaskStore();let release,called=false;
  const [one,two]=store.enqueue([{type:'upload',run:({signal})=>new Promise((resolve,reject)=>{release=resolve;signal.addEventListener('abort',()=>reject(Object.assign(Error('cancelled'),{name:'AbortError'})));})},{type:'upload',run:()=>{called=true}}]);await tick();assert.equal(store.cancel(two.id),true);assert.equal((await two.promise).ok,false);assert.equal(called,false);assert.equal(store.cancel(one.id),true);assert.equal((await one.promise).error.name,'AbortError');
  let finish;const [processing]=store.enqueue([{type:'upload',run:async({update})=>{update({phase:'processing'});await new Promise(r=>finish=r);return{id:'saved'}}}]);await tick();assert.equal(store.cancel(processing.id),false);finish();assert.equal((await processing.promise).ok,true);store.dispose();
});
test('capacity and history cleanup free runner references without cancelling active work',async()=>{
  const store=new TaskStore({limit:2,history:1});let release;
  const [running,queued]=store.enqueue([{type:'upload',run:()=>new Promise(r=>release=r)},{type:'upload',run:()=>{throw Error('failed')}}]);await tick();assert.throws(()=>store.enqueue([{type:'upload',run:()=>{}}]),/超过/);store.clear({failed:true});assert.equal(store.jobs.size,2);release({id:'saved'});await running.promise;await queued.promise;store.clear({failed:true});assert.equal(store.jobs.size,0);store.dispose();assert.throws(()=>store.enqueue([]),/关闭/);
});
test('server completions only signal new data once and disposal cancels pending file work',async()=>{
  const store=new TaskStore();store.setRemote({imports:[{id:'old',status:'completed'}],backup:null,error:null});assert.equal(store.changes,0);store.setRemote({imports:[{id:'old',status:'completed'},{id:'new',status:'running'}],backup:null,error:null});store.setRemote({imports:[{id:'old',status:'completed'},{id:'new',status:'completed'}],backup:null,error:null});assert.equal(store.changes,1);store.setRemote(store.remote);assert.equal(store.changes,1);
  let ran=false;const [task]=store.enqueue([{type:'upload',run:()=>{ran=true}}]);store.dispose();assert.equal((await task.promise).ok,false);await tick();assert.equal(ran,false);
});
test('clearing finished tasks respects the selected library and retains other libraries',async()=>{
  const store=new TaskStore();const tasks=store.enqueue([{type:'upload',collection_id:'a',run:()=>({id:'a'})},{type:'upload',collection_id:'b',run:()=>({id:'b'})}]);await Promise.all(tasks.map(t=>t.promise));store.clear({failed:true,scope:'a'});assert.deepEqual(store.getSnapshot().jobs.map(j=>j.collection_id),['b']);store.dispose();
});
