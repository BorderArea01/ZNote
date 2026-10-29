import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer,request} from 'node:http';
import {createDohLookup,captureDohProviders,dohAnswer} from '../server/capture-doh.js';
import {createCaptureHostResolver} from '../server/capture-dns.js';
import {createCaptureDocumentFetcher} from '../server/capture-page.js';

const providers=captureDohProviders,rows=[{address:'93.184.216.34',family:4}];
const dnsFailure=()=>Object.assign(Error('system DNS unavailable'),{code:'ENOTFOUND'});
const answer=(host,type,records=[])=>({Status:0,Question:[{name:host+'.',type}],Answer:records});
const a=(name,data='93.184.216.34',TTL=30)=>({name,type:1,data,TTL});
const resolver=options=>createCaptureHostResolver({lookup:async()=>{throw dnsFailure()},pause:async()=>{},report:()=>{},...options});

test('system success avoids all public DNS; only temporary resolution failures fall back in order',async()=>{
 let calls=0;const events=[],resolve=resolver({dohLookup:async provider=>{calls++;if(provider.name==='dnspod')throw Object.assign(Error(),{code:'ETIMEDOUT'});return {addresses:rows,ttl:30}},report:event=>events.push(event)});
 assert.deepEqual(await resolve('work.example'),rows);assert.equal(calls,2);assert.deepEqual(events.map(e=>e.resolver),['system','dnspod','cloudflare']);assert.ok(events.every(e=>!('url' in e)&&!('token' in e)));
 const healthy=resolver({lookup:async()=>rows,dohLookup:()=>assert.fail('No DoH on healthy system')});assert.deepEqual(await healthy('work.example'),rows);
 const invalid=resolver({lookup:async()=>{throw Object.assign(Error(),{code:'EINVAL'})},dohLookup:()=>assert.fail('No DoH on invalid arguments')});await assert.rejects(invalid('work.example'),{code:'EINVAL'});
});

test('fallback A and AAAA keep all matching CNAME addresses and exclude unrelated answers',()=>{
 const parsed=dohAnswer(answer('work.example',1,[a('noise.example','10.0.0.1'),{name:'work.example.',type:5,data:'cdn.example.',TTL:10},a('cdn.example.'),a('cdn.example.','127.0.0.1')]),'work.example',1);
 assert.deepEqual(parsed,{addresses:[...rows,{address:'127.0.0.1',family:4}],ttl:10});
 assert.deepEqual(dohAnswer(answer('work.example',28,[{name:'work.example',type:28,data:'2606:4700::1111',TTL:20}]),'work.example',28).addresses,[{address:'2606:4700::1111',family:6}]);
});

test('mismatched questions, truncation, invalid addresses, excessive records and NXDOMAIN cannot become success',()=>{
 for(const data of [answer('other.example',1,[a('other.example')]),{...answer('work.example',1),TC:true},answer('work.example',1,[a('work.example','not an IP')]),answer('work.example',1,Array.from({length:129},()=>a('work.example'))),{...answer('work.example',1),Status:3}])assert.throws(()=>dohAnswer(data,'work.example',1));
 assert.deepEqual(dohAnswer(answer('work.example',1,[a('unrelated.example')]),'work.example',1).addresses,[]);
});

test('DoH uses fixed TLS host and pinned bootstrap; no credentials, redirection or system lookup',async()=>{
 const server=createServer((req,res)=>{const url=new URL(req.url,'https://doh.pub');res.setHeader('Content-Type','application/json');const type=Number(url.searchParams.get('type'));res.end(JSON.stringify(answer(url.searchParams.get('name'),type,type===1?[a('work.example')]:[])))});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const seen=[];
 try{
  const lookup=createDohLookup({getProxy:()=>assert.fail('Tencent is direct'),request:(url,opts,cb)=>{assert.equal(url.origin,'https://doh.pub');assert.equal(opts.servername,'doh.pub');assert.equal(opts.agent,false);assert.equal(opts.rejectUnauthorized,undefined);assert.equal(opts.headers.Authorization,undefined);assert.equal(opts.headers.Cookie,undefined);opts.lookup(url.hostname,{},(err,ip,family)=>{assert.equal(err,null);seen.push({ip,family})});return request('http://127.0.0.1:'+server.address().port+url.pathname+url.search,{signal:opts.signal},cb)}});
  assert.deepEqual(await lookup(providers[0],'work.example',{signal:AbortSignal.timeout(1000)}),{addresses:rows,ttl:30});assert.equal(seen.length,2);assert.ok(seen.every(r=>r.ip==='1.12.12.12'&&r.family===4));
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r))}
});

test('Cloudflare reuses the existing proxy; IPv6-only response still resolves',async()=>{
 const marker={},server=createServer((req,res)=>{const type=Number(new URL(req.url,'https://cloudflare-dns.com').searchParams.get('type'));res.setHeader('Content-Type','application/dns-json');res.end(JSON.stringify(answer('work.example',type,type===28?[{name:'work.example',type:28,data:'2606:4700::1111',TTL:30}]:[])))});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{const lookup=createDohLookup({getProxy:()=>marker,request:(url,opts,cb)=>{assert.equal(opts.agent,marker);assert.equal(opts.lookup,undefined);assert.equal(url.origin,'https://cloudflare-dns.com');return request('http://127.0.0.1:'+server.address().port+url.search,{signal:opts.signal},cb)}});assert.equal((await lookup(providers[1],'work.example',{signal:AbortSignal.timeout(1000)})).addresses[0].family,6)}finally{server.closeAllConnections();await new Promise(r=>server.close(r))}
});

test('DoH rejects HTTP redirects, oversized bodies, wrong MIME and incomplete responses',async()=>{
 for(const mode of ['redirect','large','mime','incomplete']){
  const server=createServer((_req,res)=>{if(mode==='redirect'){res.writeHead(302,{Location:'http://127.0.0.1/secret'});res.end()}else if(mode==='mime'){res.writeHead(200,{'Content-Type':'text/html'});res.end('<html>')}else if(mode==='large'){res.writeHead(200,{'Content-Type':'application/json'});res.end('x'.repeat(65537))}else{res.writeHead(200,{'Content-Type':'application/json','Content-Length':100});res.write('{');setImmediate(()=>res.destroy())}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  try{const lookup=createDohLookup({request:(_url,opts,cb)=>request('http://127.0.0.1:'+server.address().port,{signal:opts.signal},cb)});await assert.rejects(lookup(providers[0],'work.example',{signal:AbortSignal.timeout(1000)}));}finally{server.closeAllConnections();await new Promise(r=>server.close(r))}
 }
});

test('private results remain rejected before any resource or proxy connection, with no alternative resolver bypass',async()=>{
 let fallbackCalls=0;const resolveHost=resolver({dohLookup:async()=>{fallbackCalls++;return {addresses:[...rows,{address:'192.168.1.1',family:4}],ttl:30}}});
 const fetch=createCaptureDocumentFetcher({resolveHost,proxyAgent:()=>assert.fail('Must validate before proxy'),request:()=>assert.fail('Must not connect')});await assert.rejects(fetch('https://work.example/share',AbortSignal.timeout(1000)),/内网/);assert.equal(fallbackCalls,1);
 const privateSystem=resolver({lookup:async()=>[{address:'127.0.0.1',family:4}],dohLookup:()=>assert.fail('No bypass of private system answer')});assert.equal((await privateSystem('work.example'))[0].address,'127.0.0.1');
});

test('LAN names do not leak to public DNS; complete failure reports the hostname and stops',async()=>{
 for(const host of ['printer','printer.local','host.localhost','host.lan','node.internal'])await assert.rejects(resolver({dohLookup:()=>assert.fail('Private name leaked')})(host),e=>e.code==='CAPTURE_DNS_FAILED'&&e.hostname===host);
 let calls=0;await assert.rejects(resolver({dohLookup:async()=>{calls++;throw Object.assign(Error(),{code:'DOH_HTTP_503'})}})('work.example'),e=>e.code==='CAPTURE_DNS_FAILED'&&e.cause.code==='DOH_HTTP_503');assert.equal(calls,2);
});

test('fallback cache honors CNAME TTL, returns copies, expires and always tries healthy system first',async()=>{
 let time=0,calls=0,healthy=false;const resolve=resolver({now:()=>time,lookup:async()=>{if(healthy)return [{address:'8.8.8.8',family:4}];throw dnsFailure()},dohLookup:async()=>{calls++;return {addresses:rows.map(r=>({...r})),ttl:2}}});
 const first=await resolve('work.example');first[0].address='127.0.0.1';time=1000;assert.deepEqual(await resolve('work.example'),rows);assert.equal(calls,1);time=2001;assert.deepEqual(await resolve('work.example'),rows);assert.equal(calls,2);healthy=true;assert.equal((await resolve('work.example'))[0].address,'8.8.8.8');
});

test('cancellation stops in-flight fallback without continuing to Cloudflare',async()=>{
 const abort=new AbortController();let calls=0;const resolve=resolver({dohLookup:async(_p,_h,{signal})=>{calls++;abort.abort();signal.throwIfAborted()}});await assert.rejects(resolve('work.example',{signal:abort.signal}),{name:'AbortError'});assert.equal(calls,1);
});

test('stalled fallback is aborted within its budget and a late result cannot overwrite the next provider',async()=>{
 let firstSignal,finishFirst;const resolve=resolver({dohTimeoutMs:10,dohLookup:(p,_h,{signal})=>{if(p.name==='dnspod'){firstSignal=signal;return new Promise(r=>finishFirst=r)}return Promise.resolve({addresses:rows,ttl:0})}});
 assert.deepEqual(await resolve('work.example'),rows);assert.equal(firstSignal.aborted,true);finishFirst({addresses:[{address:'127.0.0.1',family:4}],ttl:30});await new Promise(r=>setImmediate(r));
});
