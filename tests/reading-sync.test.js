import {test} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {ReadingSync} from '../src/reading-sync.js';
test('unfiled history rejects other libraries and drops moved entries',async()=>{
 const client=new ReadingSync(null,()=>{},async()=>({collection_id:'another-library',version:0,epoch:'e',entries:[{item_id:'wrong',collection_id:'another-library'}]}));
 await client.load();assert.equal(client.state.status,'error');assert.equal(client.state.data,null);
 client.request=async()=>({collection_id:null,version:0,epoch:'e',entries:[{item_id:'own',collection_id:null},{item_id:'moved',collection_id:'another-library'}]});
 await client.load();assert.equal(client.state.status,'ready');assert.deepEqual(client.state.data.entries.map(e=>e.item_id),['own']);client.dispose();
});
test('reading sync coalesces, survives a lost response, protects newer devices and ignores stale reads',async()=>{
 const storage=new Map();globalThis.localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)};
 let server={version:0,epoch:'epoch',entries:[]},lastId='',lost=false,pauseRead=null,gate=null;const writes=[];
 const request=async(path,options={})=>{if(!options.method){const value=structuredClone(server);if(pauseRead){const wait=pauseRead;pauseRead=null;await wait}return value}
  const b=JSON.parse(options.body);writes.push(b);if(gate){const wait=gate;gate=null;await wait}
  if(b.request_id===lastId)return structuredClone(server);
  if(b.version!==server.version)throw Object.assign(Error('conflict'),{status:409});
  lastId=b.request_id;server={...server,version:server.version+1,entries:options.method==='DELETE'?[]:[{item_id:b.item_id}]};
  if(lost){lost=false;throw Error('network lost')};return structuredClone(server)
 };
 let client=new ReadingSync(null,()=>{},request);await client.load();const ids=Array.from({length:7},()=>randomUUID());
 client.record(ids[0]);client.record(ids[1]);await client.flush();assert.equal(writes.length,1);assert.equal(server.entries[0].item_id,ids[1]);
 let release;gate=new Promise(r=>release=r);client.record(ids[2]);lost=true;const saving=client.flush();client.record(ids[3]);release();await saving;assert.equal(client.state.status,'error');const failedId=writes.at(-1).request_id;
 client.dispose();client=new ReadingSync(null,()=>{},request);await client.load();await client.retry();assert.equal(writes.at(-1).request_id,failedId);await client.flush();assert.equal(server.entries[0].item_id,ids[3]);
 client.record(ids[4]);server={...server,version:server.version+1,entries:[{item_id:ids[6]}]};await client.flush();assert.equal(client.state.status,'conflict');assert.equal(server.entries[0].item_id,ids[6]);await client.replaceWithLatest();assert.equal(server.entries[0].item_id,ids[4]);
 let releaseRead;pauseRead=new Promise(r=>releaseRead=r);const reading=client.load();client.record(ids[5]);await client.flush();const latest=client.state.data.version;releaseRead();await reading;assert.equal(client.state.data.version,latest);
 await client.clear();assert.equal(server.entries.length,0);assert.equal(storage.get('znote:reading-pending:v1'),'{}');const beforeCancel=writes.length;client.record(ids[0]);client.cancelItems([ids[0]]);await client.flush();assert.equal(writes.length,beforeCancel,'a pending view is cancelled before moving its picture');client.dispose();delete globalThis.localStorage;
});

test('video synchronization preserves position payloads and keeps image pending state separate',async()=>{
 const storage=new Map([['znote:reading-pending:v1','{"preserved":true}']]);globalThis.localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)};
 let server={version:0,epoch:'video-epoch',entries:[]};const writes=[];
 const request=async(path,options={})=>{assert.ok(path.startsWith('/api/video-progress'));if(!options.method)return structuredClone(server);const data=JSON.parse(options.body);writes.push(data);if(data.version!==server.version)throw Object.assign(Error('conflict'),{status:409});server={...server,version:server.version+1,entries:[data]};return structuredClone(server);};
 const client=new ReadingSync(null,()=>{},request,{endpoint:'/api/video-progress',storageKey:'znote:video-pending:v1'});await client.load();const id=randomUUID();
 client.record({item_id:id,position:12.5,duration:60,completed:false});server.version++;await client.flush();assert.equal(client.state.status,'conflict');await client.replaceWithLatest();assert.equal(writes.at(-1).position,12.5);assert.equal(writes.at(-1).duration,60);assert.equal(writes.at(-1).completed,false);
 client.cancelItems([id],{block:true});const count=writes.length;client.record({item_id:id,position:15,duration:60,completed:false});await client.flush();assert.equal(writes.length,count);client.allowItem(id);client.record({item_id:id,position:16,duration:60,completed:false});await client.flush();assert.equal(writes.at(-1).position,16);
 assert.equal(storage.get('znote:reading-pending:v1'),'{"preserved":true}');client.dispose();delete globalThis.localStorage;
});
