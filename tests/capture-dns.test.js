import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer,request} from 'node:http';
import {mkdtemp} from 'node:fs/promises';
import {resolve} from 'node:path';
import sharp from 'sharp';
import {createCaptureHostResolver} from '../server/capture-dns.js';
import {createCaptureDocumentFetcher} from '../server/capture-page.js';
import {createRemoteImageFetcher} from '../server/remote-images.js';
import {createApp} from '../server/app.js';
const publicResult=[{address:'93.184.216.34',family:4}],dnsError=code=>Object.assign(Error('DNS fault'),{code});

test('first ENOTFOUND recovers before creating any duplicate request',async()=>{
 const delays=[];let calls=0;const resolveHost=createCaptureHostResolver({lookup:async(host,options)=>{assert.equal(host,'work.example');assert.deepEqual(options,{all:true});if(++calls===1)throw dnsError('ENOTFOUND');return publicResult},pause:async ms=>delays.push(ms)});
 assert.deepEqual(await resolveHost('work.example'),publicResult);assert.equal(calls,2);assert.deepEqual(delays,[300]);
});
test('persistent DNS failures stop after three attempts with a precise public error',async()=>{
 let calls=0;const delays=[],resolveHost=createCaptureHostResolver({lookup:async()=>{calls++;throw dnsError('EAI_AGAIN')},pause:async ms=>delays.push(ms),fallbacks:[]});
 await assert.rejects(resolveHost('work.example'),e=>e.code==='CAPTURE_DNS_FAILED'&&e.status===502&&e.cause.code==='EAI_AGAIN'&&/域名/.test(e.message));assert.equal(calls,3);assert.deepEqual(delays,[300,900]);
});
test('non-network resolution errors are not retried',async()=>{
 let calls=0;const resolveHost=createCaptureHostResolver({lookup:async()=>{calls++;throw dnsError('EINVAL')},pause:()=>assert.fail('Must not wait')});await assert.rejects(resolveHost('work.example'),{code:'EINVAL'});assert.equal(calls,1);
});
test('cancellation during backoff stops before the next lookup',async()=>{
 const abort=new AbortController();let calls=0;const resolveHost=createCaptureHostResolver({lookup:async()=>{calls++;throw dnsError('ENOTFOUND')},pause:async(_ms,signal)=>{abort.abort();signal.throwIfAborted()}});await assert.rejects(resolveHost('work.example',{signal:abort.signal}),{name:'AbortError'});assert.equal(calls,1);
});
test('cancelled in-flight DNS completes promptly even if native getaddrinfo stays pending',async()=>{
 const abort=new AbortController(),resolveHost=createCaptureHostResolver({lookup:()=>new Promise(()=>{}),timeoutMs:1000});const result=resolveHost('work.example',{signal:abort.signal});await new Promise(r=>setImmediate(r));abort.abort();await assert.rejects(result,{name:'AbortError'});
});
test('a stalled lookup is bounded and a late rejection cannot corrupt the successful retry',async()=>{
 let calls=0,rejectFirst;const resolveHost=createCaptureHostResolver({lookup:()=>++calls===1?new Promise((_resolve,reject)=>rejectFirst=reject):Promise.resolve(publicResult),pause:async()=>{},timeoutMs:10});assert.deepEqual(await resolveHost('work.example'),publicResult);rejectFirst(dnsError('ENOTFOUND'));await new Promise(r=>setImmediate(r));assert.equal(calls,2);
});

async function fixture(handler,run){
 const server=createServer(handler);await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const connect=(url,options,cb)=>request('http://127.0.0.1:'+server.address().port+url.pathname,{headers:options.headers},cb);
 try{await run(connect)}finally{server.closeAllConnections();await new Promise(r=>server.close(r))}
}
test('short-link redirects resolve independently and keep validated DNS pinning after retry',async()=>{
 const hosts=[],connections=[];let second=0;
 await fixture((req,res)=>{if(req.url==='/share'){res.writeHead(302,{Location:'https://detail.example/work'});res.end()}else{res.writeHead(200,{'Content-Type':'text/html'});res.end('<h1>作品</h1>')}},async connect=>{
  const resolveHost=createCaptureHostResolver({lookup:async host=>{hosts.push(host);if(host==='detail.example'&&++second===1)throw dnsError('ENOTFOUND');return publicResult},pause:async()=>{}});
  const fetch=createCaptureDocumentFetcher({resolveHost,proxyAgent:()=>undefined,request:(url,options,cb)=>{options.lookup(url.hostname,{},(_error,address,family)=>connections.push({host:url.hostname,address,family}));return connect(url,options,cb)}});
  const result=await fetch('https://short.example/share',new AbortController().signal);assert.equal(result.url,'https://detail.example/work');assert.deepEqual(hosts,['short.example','detail.example','detail.example']);assert.deepEqual(connections,[{host:'short.example',...{address:'93.184.216.34',family:4}},{host:'detail.example',address:'93.184.216.34',family:4}]);
 });
});
test('a DNS retry returning any private address cannot reach the resource, even with a proxy',async()=>{
 let calls=0;const resolveHost=createCaptureHostResolver({lookup:async()=>{if(++calls===1)throw dnsError('ENOTFOUND');return [...publicResult,{address:'192.168.1.1',family:4}]},pause:async()=>{}});
 const fetch=createCaptureDocumentFetcher({resolveHost,proxyAgent:()=>assert.fail('Must validate before proxy selection'),request:()=>assert.fail('Must not request private target')});await assert.rejects(fetch('https://work.example/share',new AbortController().signal),/内网/);assert.equal(calls,2);
});
test('403 verification responses are not turned into automatic network retries',async()=>{
 let requests=0;await fixture((_req,res)=>{requests++;res.writeHead(403);res.end()},async connect=>{const fetch=createCaptureDocumentFetcher({resolveHost:async()=>publicResult,proxyAgent:()=>undefined,request:connect});await assert.rejects(fetch('https://work.example/share',new AbortController().signal),/HTTP 403/);assert.equal(requests,1)});
});
test('image DNS retries stay inside the same download and still validate the recovered address',async()=>{
 let calls=0,requests=0;await fixture((_req,res)=>{requests++;res.writeHead(200,{'Content-Type':'image/png'});res.end('image')},async connect=>{const fetch=createRemoteImageFetcher({lookup:async()=>{if(++calls===1)throw dnsError('ENOTFOUND');return publicResult},request:connect,proxyAgent:()=>undefined});assert.equal((await fetch('https://image.example/picture')).toString(),'image');assert.equal(calls,2);assert.equal(requests,1)});
});
test('a queued capture recovers from initial DNS failure without leaving a failed job or duplicate image',async()=>{
 const image=await sharp({create:{width:12,height:12,channels:3,background:'#aaaaaa'}}).png().toBuffer();let calls=0,requests=0;
 await fixture((_req,res)=>{requests++;res.writeHead(200,{'Content-Type':'image/png'});res.end(image)},async connect=>{
  const page=createCaptureDocumentFetcher({resolveHost:createCaptureHostResolver({lookup:async()=>{if(++calls===1)throw dnsError('ENOTFOUND');return publicResult},pause:async()=>{}}),request:connect,proxyAgent:()=>undefined});
  const runtime=createApp({dataDir:await mkdtemp(resolve('artifacts/dns-capture-')),captureOptions:{page}});
  try{const input={text:'https://short.example/image',request_id:'cf:11111111-1111-4111-a111-111111111111',image_mode:'group'},job=runtime.captures.add(input),done=await runtime.captures.wait(job.id,AbortSignal.timeout(5000));assert.equal(done.status,'completed');assert.equal(runtime.captures.add(input).id,job.id);assert.equal(runtime.captures.list().length,1);assert.equal(runtime.db.prepare("SELECT count(*) n FROM items WHERE kind='image'").get().n,1);assert.equal(calls,2);assert.equal(requests,1)}
  finally{for(const key of ['captures','imports','trash','backups','webhooks','weixin','weixinNotifications'])await runtime[key]?.stop?.();runtime.db.close()}
 });
});

test('persistent system DNS failure recovers through DoH in the original failed capture without duplicate writes',async()=>{
 const image=await sharp({create:{width:12,height:12,channels:3,background:'#aaaaaa'}}).png().toBuffer();let recovered=false,requests=0;
 await fixture((_req,res)=>{requests++;res.writeHead(200,{'Content-Type':'image/png'});res.end(image)},async connect=>{
  const resolveHost=createCaptureHostResolver({lookup:async()=>{throw dnsError('ENOTFOUND')},pause:async()=>{},report:()=>{},dohLookup:async provider=>{if(!recovered||provider.name==='dnspod')throw dnsError('ETIMEDOUT');return {addresses:publicResult,ttl:30}}});
  const runtime=createApp({dataDir:await mkdtemp(resolve('artifacts/doh-capture-')),captureOptions:{page:createCaptureDocumentFetcher({resolveHost,request:connect,proxyAgent:()=>undefined})}});
  try{const input={text:'https://short.example/image',request_id:'cf:doh-recovery',image_mode:'group'},job=runtime.captures.add(input);await assert.rejects(runtime.captures.wait(job.id,AbortSignal.timeout(5000)),/域名/);assert.equal(runtime.captures.get(job.id).status,'failed');assert.equal(requests,0);recovered=true;assert.equal(runtime.captures.retry(job.id).id,job.id);const done=await runtime.captures.wait(job.id,AbortSignal.timeout(5000));assert.equal(done.status,'completed');assert.equal(runtime.captures.add(input).id,job.id);assert.equal(runtime.captures.list().length,1);assert.equal(runtime.db.prepare("SELECT count(*) n FROM items WHERE kind='image'").get().n,1);assert.equal(requests,1)}
  finally{for(const key of ['captures','imports','trash','backups','webhooks','weixin','weixinNotifications'])await runtime[key]?.stop?.();runtime.db.close()}
 });
});
