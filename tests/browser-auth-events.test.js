import test from 'node:test';
import assert from 'node:assert/strict';
import {api,authenticated,uploadFile} from '../src/api.js';

test('API and upload authentication failures notify the UI, excluding login, permissions, probes and stale responses after reauthentication',async()=>{
 const originals={fetch:globalThis.fetch,window:globalThis.window,XMLHttpRequest:globalThis.XMLHttpRequest};
 let events=0;globalThis.window=new EventTarget();window.addEventListener('znote:auth-required',()=>events++);
 const response=status=>new Response(JSON.stringify({error:'Test response'}),{status,headers:{'Content-Type':'application/json'}});
 try{
  globalThis.fetch=async()=>response(401);await assert.rejects(api('/api/items'),e=>e.status===401);assert.equal(events,1);
  await assert.rejects(api('/api/auth/login'),e=>e.status===401);await assert.rejects(api('/api/me',{authProbe:true}),e=>e.status===401);assert.equal(events,1);
  globalThis.fetch=async()=>response(403);await assert.rejects(api('/api/tokens'),e=>e.status===403);assert.equal(events,1);
  let finish;globalThis.fetch=()=>new Promise(resolve=>finish=resolve);const delayed=api('/api/items');authenticated();finish(response(401));await assert.rejects(delayed);assert.equal(events,1);
  globalThis.fetch=async()=>response(401);await assert.rejects(api('/api/collections'));assert.equal(events,2);
  globalThis.XMLHttpRequest=class{upload={};open(){}send(){this.status=401;this.responseText='{"error":"请先登录"}';queueMicrotask(()=>this.onload());}};
  await assert.rejects(uploadFile(new File(['test'],'test.png',{type:'image/png'}),null),e=>e.status===401);assert.equal(events,3);
 }finally{Object.assign(globalThis,originals);}
});
