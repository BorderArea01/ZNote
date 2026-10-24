import test from 'node:test';import assert from 'node:assert/strict';
import {createServer,request} from 'node:http';
import {createRemoteImageFetcher} from '../server/remote-images.js';
import HttpsProxyAgent from 'https-proxy-agent';
import {createProxyResolver} from '../server/network-proxy.js';

async function fixture(handler,run,extra={}){
  const server=createServer(handler);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let refreshes=0,requests=0;
  const fetch=createRemoteImageFetcher({lookup:async()=>[{address:'93.184.216.34',family:4}],proxyAgent:()=>undefined,resetProxyCache:()=>{refreshes++;},timeoutMs:80,request:(url,options,cb)=>{requests++;return request(`http://127.0.0.1:${server.address().port}${url.pathname}`,{headers:options.headers},cb);},...extra});
  try{await run(fetch,()=>({refreshes,requests}));}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
test('connection reset refreshes the proxy once and saves only the complete retry response',async()=>{
  let attempts=0;await fixture((req,res)=>{if(++attempts===1){req.socket.destroy();return;}res.writeHead(200,{'Content-Type':'image/png'});res.end('complete image');},async(fetch,state)=>{
    assert.equal((await fetch('https://images.example/image')).toString(),'complete image');assert.deepEqual(state(),{refreshes:1,requests:2});
  });
});
test('a stalled response body has a deadline even after headers arrive and never hangs the queue',async()=>{
  await fixture((req,res)=>{res.writeHead(200,{'Content-Type':'image/png'});res.write('partial');},async(fetch,state)=>{
    await assert.rejects(fetch('https://images.example/image'),error=>error.code==='IMAGE_DOWNLOAD_TIMEOUT');assert.deepEqual(state(),{refreshes:1,requests:2});
  });
});
test('retry is bounded and does not mask persistent upstream failures',async()=>{
  await fixture((req,res)=>{res.writeHead(503);res.end();},async(fetch,state)=>{
    await assert.rejects(fetch('https://images.example/image'),/HTTP 503/);assert.deepEqual(state(),{refreshes:1,requests:2});
  });
});
test('404, HTML, oversized images and private redirects are not retried',async()=>{
  for(const mode of ['404','html','oversize','private'])await fixture((req,res)=>{
    if(mode==='404')res.writeHead(404);
    if(mode==='html')res.writeHead(200,{'Content-Type':'text/html'});
    if(mode==='oversize')res.writeHead(200,{'Content-Type':'image/png','Content-Length':100*1024*1024+1});
    if(mode==='private')res.writeHead(302,{Location:'http://127.0.0.1/private'});
    res.end();
  },async(fetch,state)=>{await assert.rejects(fetch('https://images.example/image'));assert.deepEqual(state(),{refreshes:0,requests:1});});
});
test('each redirect is validated and uses the newly resolved public destination',async()=>{
  await fixture((req,res)=>{if(req.url==='/start'){res.writeHead(302,{Location:'https://other.example/end'});res.end();}else{res.writeHead(200,{'Content-Type':'image/jpeg'});res.end('complete');}},async(fetch,state)=>{
    assert.equal((await fetch('https://images.example/start')).toString(),'complete');assert.deepEqual(state(),{refreshes:0,requests:2});
  });
});
test('initial private DNS results are rejected before creating a network request',async()=>{
  await fixture(()=>assert.fail('Must not connect'),async(fetch,state)=>{
    await assert.rejects(fetch('https://images.example/image'),/内网/);assert.deepEqual(state(),{refreshes:0,requests:0});
  },{lookup:async()=>[{address:'192.168.1.1',family:4}]});
});
test('a long-lived downloader switches from a cached direct route to the new proxy on retry',async()=>{
  let system='',direct=0,tunnels=0;
  const resolver=createProxyResolver({env:{},readSystem:()=>system,ttlMs:60000});
  assert.equal(resolver.url(),'');
  const origin=createServer(req=>req.socket.destroy()),proxy=createServer();
  proxy.on('connect',(req,socket)=>{
    tunnels++;assert.equal(req.url,'images.example:80');
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    socket.once('data',()=>socket.end('HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nContent-Length: 4\r\nConnection: close\r\n\r\npng!'));
  });
  await new Promise(resolve=>origin.listen(0,'127.0.0.1',resolve));await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));
  system=`http://127.0.0.1:${proxy.address().port}`;
  const fetch=createRemoteImageFetcher({lookup:async()=>[{address:'93.184.216.34',family:4}],timeoutMs:1000,
    proxyAgent:()=>resolver.url()?new HttpsProxyAgent(resolver.url()):undefined,resetProxyCache:()=>resolver.reset(),
    request:(url,options,cb)=>{if(options.agent)return request(url,options,cb);direct++;return request(`http://127.0.0.1:${origin.address().port}/image`,cb);}});
  try{assert.equal((await fetch('http://images.example/image')).toString(),'png!');assert.equal(direct,1);assert.equal(tunnels,1);}
  finally{origin.closeAllConnections();proxy.closeAllConnections();await Promise.all([new Promise(resolve=>origin.close(resolve)),new Promise(resolve=>proxy.close(resolve))]);}
});

test('Mangapill CDN gets its public hotlink referer only on the exact image host, including redirects',async()=>{
  const received=[];
  await fixture((req,res)=>{received.push(req.headers.referer);if(req.url==='/start'){res.writeHead(302,{Location:'https://other.example/end'});res.end();}else{res.writeHead(200,{'Content-Type':'image/jpeg'});res.end('image');}},async fetch=>{
    await fetch('https://cdn.readdetectiveconan.com/image');
    await fetch('https://cdn.readdetectiveconan.com.evil.test/image');
    await fetch('https://cdn.readdetectiveconan.com/start');
    assert.deepEqual(received,['https://mangapill.com/',undefined,'https://mangapill.com/',undefined]);
  });
});
