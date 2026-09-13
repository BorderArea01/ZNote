import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const {normalizeAddress,sameOrigin,externalLink}=createRequire(import.meta.url)('../clients/desktop/policy.cjs');
test('desktop address policy separates local HTTP from public HTTPS and rejects URL capabilities',()=>{
 for(const address of ['127.0.0.1:3741','10.2.3.4:3741','192.168.1.10:3741','[::1]:3741','[fd00::1]:3741','nas.local:3741'])assert.ok(normalizeAddress(address).startsWith('http:'));
 assert.equal(normalizeAddress('https://notes.example.com/'),'https://notes.example.com');
 for(const address of ['http://example.com','http://10.attacker.com','http://172.32.1.1','file:///x','javascript:alert(1)','https://a:b@example.com','http://localhost:3741/api','https://example.com/?token=secret'])assert.throws(()=>normalizeAddress(address));
 assert.equal(sameOrigin('http://localhost:3741/api','http://localhost:3741'),true);
 assert.equal(sameOrigin('http://localhost:3741.evil.test/','http://localhost:3741'),false);
 assert.equal(externalLink('file:///secret'),false);assert.equal(externalLink('https://user:password@example.com'),false);
});
test('PWA stores only public offline page; authenticated API and originals remain uncached',async()=>{
 const events={},stored=[],requests=[];
 const context={URL,Response,self:{location:{origin:'https://notes.example.com'},clients:{claim:async()=>{}},addEventListener:(name,fn)=>events[name]=fn},caches:{open:async()=>({add:async p=>stored.push(p)}),keys:async()=>[],match:async p=>new Response(p)},fetch:async r=>{requests.push(r.url);throw Error('offline')}};
 vm.runInNewContext(await readFile('public/sw.js','utf8'),context);
 let result;events.install({waitUntil:p=>result=p});await result;assert.deepEqual(stored,['/offline.html']);
 for(const path of ['/api/items','/media/original.png']){let used=false;events.fetch({request:{url:'https://notes.example.com'+path,method:'GET',mode:'navigate'},respondWith:()=>used=true});assert.equal(used,false)}
 events.fetch({request:{url:'https://notes.example.com/',method:'GET',mode:'navigate'},respondWith:p=>result=p});assert.equal(await(await result).text(),'/offline.html');
});
