import test from 'node:test';import assert from 'node:assert/strict';
import {api,connection} from '../addons/browser/clipper/client.js';
import {inboxFixture} from './helpers/cloudflare-inbox-fixture.js';
const config={server:'http://127.0.0.1:3741',token:'zn_'+'a'.repeat(64),remoteServer:'https://inbox.example',remoteToken:'zn_'+'b'.repeat(64)};
globalThis.chrome={};
const response=data=>Response.json(data),id='12345678-1234-4123-8123-123456789abc';
function environment(t,handler){const saved={};t.mock.method(globalThis,'fetch',handler);t.mock.property(globalThis,'chrome',{storage:{local:{get:async keys=>Object.fromEntries((typeof keys==='string'?[keys]:keys).filter(k=>k in saved).map(k=>[k,saved[k]])),set:async data=>Object.assign(saved,data)}}});return saved;}
test('healthy local authorization uses no remote request',async t=>{
 const calls=[];environment(t,async(url,options)=>{calls.push(url);assert.equal(options.headers.Authorization,'Bearer '+config.token);return response(url.endsWith('/api/health')?{status:'ok',version:'1'}:url.endsWith('/api/me')?{scope:'write'}:{id,status:'queued'});});
 assert.equal((await api('/api/captures',{method:'POST',body:'{"text":"https://example.com/1"}'},config)).connection.remote,false);assert.equal(calls.length,3);assert.ok(calls.every(u=>u.startsWith(config.server)));
});
test('fallback strips browser data, separates credentials and pins the remote queue through LAN recovery',async t=>{
 let online=false;const calls=[];environment(t,async(url,options)=>{calls.push({url,method:options.method});if(url.startsWith(config.server)){assert.equal(options.headers.Authorization,'Bearer '+config.token);if(!online)throw Error('offline');return response(url.endsWith('/health')?{status:'ok',version:'1'}:{scope:'write'});}assert.equal(options.headers.Authorization,'Bearer '+config.remoteToken);if(options.method==='POST'&&url.endsWith('/api/captures')){const body=JSON.parse(options.body);assert.equal(body.browser_html,undefined);assert.equal(body.browser_post,undefined);assert.equal(body.text,'https://example.com/video');return response({id,status:'queued'});}return response({id,status:'completed'});});
 const job=await api('/api/imports',{method:'POST',body:JSON.stringify({url:'https://example.com/video',browser_html:'private',browser_post:{private:true},request_id:'same-job'})},config);assert.equal(job.connection.kind,'captures');online=true;const before=calls.length;await api('/api/imports/'+id,{},config);await api('/api/imports/'+id+'/retry',{method:'POST'},config);assert.ok(calls.slice(before).every(c=>c.url.startsWith(config.remoteServer+'/api/captures/')));assert.equal((await connection(config)).remote,false);
});
test('an uncertain POST is never replayed to the other queue',async t=>{
 let writes=0;environment(t,async(url,options)=>{if(options.method==='POST'){writes++;throw Error('response lost after write');}return response(url.endsWith('/health')?{status:'ok',version:'1'}:{scope:'write'});});
 await assert.rejects(api('/api/captures',{method:'POST',body:'{}'},config),/response lost/);assert.equal(writes,1);
});
test('unavailable LAN rejects original uploads and download-only resolution without uploading them to cloud',async t=>{
 environment(t,async url=>{assert.ok(url.startsWith(config.server));throw Error('offline');});
 await assert.rejects(api('/api/assets',{method:'POST',body:new FormData()},config),/只支持作品链接/);await assert.rejects(api('/api/captures/resolve',{method:'POST',body:'{}'},config),/只支持作品链接/);
});
test('wrong service and revoked local token select remote; cancellation never falls back',async t=>{
 let mode='wrong';environment(t,async url=>response(url.endsWith('/health')?{status:'ok',version:'1',...(mode==='wrong'?{mode:'remote-capture'}:{})}:{scope:'read'}));
 assert.equal((await connection(config)).remote,true);mode='revoked';assert.equal((await connection(config)).remote,true);
 const controller=new AbortController();controller.abort(Error('cancelled'));t.mock.method(globalThis,'fetch',async()=>{throw controller.signal.reason;});await assert.rejects(connection(config,{signal:controller.signal}),/cancelled/);
});
test('only the fixed extension may write with its own authorized cloud device token',async()=>{
 const f=await inboxFixture();try{const cookie=await f.pair();const device=await(await f.call('/api/tokens','POST',{scope:'write',name:'extension'},{Cookie:cookie})).json();const input={text:'https://example.com/one',request_id:'extension-origin'};
 const origin='chrome-extension://ndfidbdoncgiaamafhgfpbdnbeiedile';assert.equal((await f.call('/api/captures','POST',input,{Origin:origin,Cookie:cookie})).status,403);assert.equal((await f.call('/api/captures','POST',input,{Origin:'chrome-extension://'+'x'.repeat(32),Authorization:'Bearer '+device.token})).status,403);assert.equal((await f.call('/api/captures','POST',input,{Origin:origin,Authorization:'Bearer '+device.token})).status,202);
 }finally{f.sql.close();}
});
