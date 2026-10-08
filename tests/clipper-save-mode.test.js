import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createApp} from '../server/app.js';
import {downloadWork} from '../addons/browser/clipper/work-download.js';

test('download parser does not create library content or capture history; accepts only bounded platform browser data',async()=>{
  const runtime=createApp({dataDir:await mkdtemp(join(tmpdir(),'znote-resolve-')),captureOptions:{page:async url=>({plan:{kind:'note',url,title:'套图',images:['https://cdn.example/1.png','https://cdn.example/2.png']}})}});
  const server=runtime.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  try{
    const base='http://127.0.0.1:'+server.address().port;
    const setup=await fetch(base+'/api/auth/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'0123'})});
    const cookie=setup.headers.get('set-cookie').split(';')[0];
    const response=await fetch(base+'/api/captures/resolve',{method:'POST',headers:{cookie,'Content-Type':'application/json'},body:JSON.stringify({text:'https://gallery.example/post/1'})});
    assert.equal(response.status,200);assert.equal((await response.json()).plan.images.length,2);
    assert.equal(runtime.db.prepare('SELECT count(*) n FROM items').get().n,0);assert.equal(runtime.captures.list().length,0);
    await assert.rejects(()=>runtime.captures.resolve({text:'https://gallery.example/post/1',browser_html:'<html></html>'}),/只支持小红书/);
    await assert.rejects(()=>runtime.captures.resolve({text:'https://www.xiaohongshu.com/explore/abcd',browser_html:'x'.repeat(1500001)}),/过大/);
    assert.equal((await fetch(base+'/api/captures/resolve',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"text":"https://gallery.example/post/1"}'})).status,401);
  }finally{for(const key of ['captures','imports','trash','backups','webhooks','weixin'])await runtime[key].stop();await new Promise(r=>server.close(r));runtime.db.close();}
});

test('whole-work downloads keep every live segment, skip covers, try alternate images and continue after file failure',async()=>{
  const plan={title:'套图',url:'https://gallery.example/one',images:['https://cdn.example/cover1.png','https://cdn.example/fail.png','https://cdn.example/ok.png','https://cdn.example/cover2.png'],image_candidates:[['https://cdn.example/ok.png','https://cdn.example/fallback.png']],live_videos:[{index:0,urls:['https://cdn.example/live1.mp4']},{index:3,urls:['https://cdn.example/live2.mp4']}]};
  const read=[],files=[];
  await assert.rejects(()=>downloadWork({kind:'work'}, {},async(blob,name)=>files.push(name),()=>{}, {
    resolve:async()=>plan,
    image:async url=>{read.push(url);if(!url.includes('fallback'))throw Error('读取失败');return new Blob(['png'],{type:'image/png'});},
    video:async url=>{read.push(url);return new Blob(['video']);},
  }),/已下载 3\/4 项，1 项失败/);
  assert.equal(read.some(url=>url.includes('cover')),false);assert.equal(files.length,3);
  assert.ok(files.some(f=>f.endsWith('/001.mp4')));assert.ok(files.some(f=>f.endsWith('/004.mp4')));assert.ok(files.some(f=>f.endsWith('/003.png')));
});

test('text-only download retains source; unavailable video never falls back to library upload',async()=>{
  const files=[];
  await downloadWork({}, {},async(blob,name)=>files.push([name,await blob.text()]),()=>{},{resolve:async()=>({title:'笔记',content:'学习正文',url:'https://example.com/note'})});
  assert.match(files[0][1],/来源：https:\/\/example.com\/note/);
  await assert.rejects(()=>downloadWork({videoOnly:true},{},()=>assert.fail('must not save'),()=>{},{resolve:async()=>({kind:'video',url:'https://example.com'})}),/没有提供.*直链/);
});
