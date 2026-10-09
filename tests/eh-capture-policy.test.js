import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createEhPolicy,ehSite} from '../server/capture-eh-policy.js';
import {createCaptureManager} from '../server/captures.js';
import {ehContentWarning,confirmEhGallery} from '../server/capture-page.js';
const source='https://e-hentai.org/g/123456/abcdef/';
const banned=expiry=>Buffer.from('This IP address has been temporarily banned due to an excessive request rate. The ban expires in '+expiry);

test('content warnings are distinguished from login and unavailable galleries',()=>{
  const error=ehContentWarning('<html><body><h1>Content Warning</h1><a href="?nw=session">View Gallery</a></body></html>');
  assert.equal(error.code,'EH_CONTENT_WARNING');assert.match(error.message,/View Gallery/);assert.doesNotMatch(error.message,/登录/);
  assert.equal(ehContentWarning('<html><body><h1>Normal gallery</h1></body></html>'),null);
});

test('gallery warning confirmation follows only same-gallery session links and stops repeated warnings',async()=>{
  const signal=AbortSignal.timeout(5000),resource=html=>({url:source,buffer:Buffer.from(html)}),warning=href=>resource(`<h1>Content Warning</h1><a href="${href}">View Gallery</a>`);
  let reads=0;
  const normal=resource('<h1>Gallery</h1>');
  const result=await confirmEhGallery(warning('?nw=session'),signal,async(url,_,redirects,extra)=>{
    reads++;assert.equal(url,source+'?nw=session');assert.equal(redirects,0);assert.equal(extra.ehSession.origin,new URL(source).origin);assert.equal(extra.ehSession.cookie,'');extra.ehSession.cookie='nw=1';return normal;
  });
  assert.equal(reads,1);assert.equal(result.resource,normal);assert.equal(result.session.cookie,'nw=1');
  for(const href of ['?nw=always','https://evil.test/?nw=session','/g/999/abcdef/?nw=session','https://user:pass@e-hentai.org/g/123456/abcdef/?nw=session']){
    await assert.rejects(confirmEhGallery(warning(href),signal,()=>{throw Error('Must not request');}),e=>e.code==='EH_CONTENT_WARNING');
  }
  await assert.rejects(confirmEhGallery(warning('?nw=session'),signal,async()=>warning('?nw=session')),e=>e.code==='EH_CONTENT_WARNING');
  assert.equal((await confirmEhGallery(normal,signal,()=>{throw Error('No request');})).resource,normal);
});

test('deferred gallery reads refresh a failed member once, skip saved members on retry and retain page order',async()=>{
  const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT)');
  const saved=new Map(),reads=[],downloads=[];let allowSecond=false;
  const pages=[1,2,3].map(i=>`https://e-hentai.org/s/abc/123456-${i}`);
  const manager=createCaptureManager({db,dataDir:'unused',validateCollection:()=>{},work:fn=>fn(),exists:id=>saved.get(id),page:async(_,signal,redirects,options)=>{assert.equal(options.deferImages,true);return {plan:{kind:'note',default_image_mode:'group',url:source,title:'Gallery',images:pages,image_pages:pages}};},imagePage:async url=>{reads.push(url);return ['https://cdn.example/'+url.split('-').at(-1)+'.jpg'];},image:async url=>{downloads.push(url);if(url.endsWith('2.jpg')&&!allowSecond)throw Error('expired');return Buffer.from('image');},saveImage:async(buffer,row)=>{saved.set(row.id,row);return row;}});
  try{
    const job=manager.add({text:source});await assert.rejects(manager.wait(job.id,AbortSignal.timeout(5000)),/其他图片已继续处理/);
    assert.deepEqual(reads,[pages[0],pages[1],pages[1],pages[2]]);assert.equal(saved.size,2);
    allowSecond=true;manager.retry(job.id);await manager.wait(job.id,AbortSignal.timeout(5000));
    assert.deepEqual(reads,[pages[0],pages[1],pages[1],pages[2],pages[1]]);assert.equal(saved.size,3);
    assert.deepEqual([...saved.values()].map(v=>v.group_index).sort(),[0,1,2]);assert.equal(new Set([...saved.values()].map(v=>v.group_key)).size,1);
  }finally{await manager.stop();db.close();}
});

test('E-Hentai HTTP 200 ban bodies produce bounded shared cooldowns, expire and exclude unrelated hosts',()=>{
  let time=10000;const policy=createEhPolicy({now:()=>time});
  assert.equal(policy.response('https://example.org/',banned('2 hours and 31 minutes')),null);
  assert.equal(policy.response(source,Buffer.from('<html><title>Normal gallery</title></html>')),null);
  const error=policy.response(source,banned('2 hours and 31 minutes'));
  assert.equal(error.status,429);assert.equal(error.code,'EH_RATE_LIMIT');assert.equal(error.retry_after_seconds,9060);assert.match(error.message,/151 分钟/);
  assert.throws(()=>policy.check('https://exhentai.org/s/abc/123456-1'),/临时封禁/);
  assert.doesNotThrow(()=>policy.check('https://e-hentai.org.evil.test/'));
  assert.doesNotThrow(()=>policy.check('https://www.kxmh8.com/'));
  time+=9060001;assert.doesNotThrow(()=>policy.check(source));
  assert.equal(policy.response(source,banned('unknown')).retry_after_seconds,300);
  assert.equal(policy.response(source,banned('9999 hours')).retry_after_seconds,86400);
  assert.equal(ehSite('https://www.e-hentai.org/g/1/abc/'),true);assert.equal(ehSite('invalid'),false);
});

test('E-Hentai retry refreshes expiring addresses and skips saved pages without changing grouping',async()=>{
  const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT)');
  const saved=new Map(),attempts=[];let reads=0;
  const manager=createCaptureManager({db,dataDir:'unused',validateCollection:()=>{},work:fn=>fn(),exists:id=>saved.get(id),page:async()=>{reads++;return {plan:{kind:'note',url:source,title:'Gallery',content:'Source remarks',images:[1,2].map(i=>`https://cdn.example/${i}.jpg?token=${reads}`)}};},image:async url=>{attempts.push(url);if(url.includes('2.jpg?token=1'))throw Error('expired');return Buffer.from('image');},saveImage:async(buffer,row)=>{assert.ok(!saved.has(row.id));saved.set(row.id,row);return row;},saveNote:()=>{throw Error('Unexpected note');}});
  try{
    const job=manager.add({text:source,image_mode:'group',collection_id:'target'});await assert.rejects(manager.wait(job.id,AbortSignal.timeout(5000)),/其他图片已继续处理/);
    assert.equal(saved.size,1);manager.retry(job.id);await manager.wait(job.id,AbortSignal.timeout(5000));
    assert.equal(reads,2);assert.deepEqual(attempts,['https://cdn.example/1.jpg?token=1','https://cdn.example/2.jpg?token=1','https://cdn.example/2.jpg?token=2']);
    assert.equal(saved.size,2);assert.equal(new Set([...saved.values()].map(row=>row.group_key)).size,1);assert.ok([...saved.values()].every(row=>row.source_url===source&&row.content==='Source remarks'));
  }finally{await manager.stop();db.close();}
});

test('a detected site ban stops remaining pictures and fallback requests while preserving saved pages',async()=>{
  const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT)');const saved=new Map(),attempts=[];
  const images=[1,2,3].map(i=>`https://cdn.example/${i}.jpg`);
  const manager=createCaptureManager({db,dataDir:'unused',validateCollection:()=>{},work:fn=>fn(),exists:id=>saved.get(id),page:async()=>({plan:{kind:'note',url:source,title:'Gallery',images,image_candidates:images.map(url=>[url,url+'?fallback'])}}),image:async url=>{attempts.push(url);if(url.includes('/2.jpg'))throw Object.assign(Error('IP 临时封禁'),{status:429,code:'EH_RATE_LIMIT'});return Buffer.from('image');},saveImage:async(buffer,row)=>{saved.set(row.id,row);return row;}});
  try{const job=manager.add({text:source,image_mode:'group'});await assert.rejects(manager.wait(job.id,AbortSignal.timeout(5000)),/临时封禁/);assert.equal(saved.size,1);assert.deepEqual(attempts,images.slice(0,2));}finally{await manager.stop();db.close();}
});
