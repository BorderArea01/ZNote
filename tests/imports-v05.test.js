import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, copyFile, readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createApp } from '../server/app.js';
import { platformUrl, createImportManager, downloadVideo } from '../server/imports.js';
import { withSource } from '../server/source.js';
import sharp from 'sharp';
const delay = ms => new Promise(r => setTimeout(r, ms));
const fake = async ({ dir, signal, url }) => {
  for(let i=0;i<8;i++) { if (signal.aborted) throw new Error('aborted'); await delay(10); }
  if (url.includes('/999')) throw Object.assign(new Error('平台要求登录'), { status: 422 });
  const path = join(dir,'media.mp4'); await copyFile('tests/fixtures/sample.mp4',path);
  return { path, originalname:'media.mp4', title:'测试视频', description:'原有说明', author:'采集作者',author_url:'https://x.com/author' };
};
test('platform URLs reject arbitrary destinations, userinfo and lookalike domains', () => {
  for(const url of ['https://www.bilibili.com/video/BV13x41117TL','https://v.douyin.com/ABC/','https://www.douyin.com/video/123','https://xhslink.com/a/abc','https://www.xiaohongshu.com/explore/abcd','https://x.com/user/status/123']) assert.ok(platformUrl(url));
  for(const url of ['file:///etc/passwd','https://127.0.0.1/video/123','https://x.com.evil.test/a/status/123','https://secret@x.com/u/status/123','https://x.com:123/u/status/123','https://x.com/user','https://www.bilibili.com/playlist/123']) assert.throws(()=>platformUrl(url));
});
test('provenance is exportable, idempotent and bounded', () => {
  const a=withSource({content:'手写备注',source_url:'https://example.com/post'});
  assert.equal(a.content,'手写备注\n\n来源链接：https://example.com/post'); assert.ok(a.captured_at);
  assert.deepEqual(withSource(a),a); assert.throws(()=>withSource({content:'x'.repeat(500000),source_url:'https://example.com'}));
});
test('short link redirect is validated before accessing its destination', async () => {
  const prior=globalThis.fetch;let calls=0;
  globalThis.fetch=async()=>{calls++;return new Response(null,{status:302,headers:{Location:'http://127.0.0.1/private'}});};
  try { await assert.rejects(()=>downloadVideo({url:'https://b23.tv/abcd',dir:resolve('artifacts'),signal:new AbortController().signal,progress:()=>{}}),e=>e.status===400);assert.equal(calls,1); }
  finally {globalThis.fetch=prior;}
});
test('startup cleans only abandoned owned import directories',async()=>{
  const dir=await mkdtemp(resolve('artifacts/import-cleanup-'));await mkdir(join(dir,'imports','job-abc123'),{recursive:true});await writeFile(join(dir,'imports','job-abc123','part'),'abandoned');await writeFile(join(dir,'imports','keep.txt'),'keep');
  const manager=createImportManager({dataDir:dir,downloader:fake,save:async()=>({id:'x'})});await manager.stop();assert.deepEqual(await readdir(join(dir,'imports')),['keep.txt']);
});
test('imports API auth, async jobs, exact media, duplicate provenance, failure, cancellation and restoration', async () => {
  const dir = await mkdtemp(resolve('artifacts/import-api-')); const runtime=createApp({dataDir:dir,importOptions:{downloader:fake}});
  const server=runtime.app.listen(0,'127.0.0.1'); await new Promise(r=>server.once('listening',r)); const base=`http://127.0.0.1:${server.address().port}`;
  let cookie=''; const req=(path,options={})=>fetch(base+path,{...options,headers:{Cookie:cookie,...options.headers}});
  const post=(path,data)=>req(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
  const wait=async id=>{ for(let i=0;i<200;i++){const j=await(await req('/api/imports/'+id)).json(); if(!['queued','running','saving'].includes(j.status))return j; await delay(15); } throw new Error('timeout'); };
  try {
    assert.equal((await post('/api/imports',{url:'https://x.com/a/status/123'})).status,401);
    cookie=(await post('/api/auth/setup',{password:'1029'})).headers.get('set-cookie').split(';')[0];
    const collection=await(await post('/api/collections',{name:'采集'})).json();
    const readonly=await(await post('/api/tokens',{name:'read',scope:'read'})).json();
    assert.equal((await req('/api/imports',{method:'POST',headers:{Cookie:'',Authorization:'Bearer '+readonly.token}})).status,403);
    assert.equal((await post('/api/imports',{url:'https://127.0.0.1/'})).status,400);
    const data={url:'https://x.com/a/status/123',tags:['参考','视频'],collection_id:collection.id};
    const submitted=await post('/api/imports',data); assert.equal(submitted.status,202); const job=await submitted.json();
    assert.equal((await(await post('/api/imports',data)).json()).id,job.id);
    const done=await wait(job.id); assert.equal(done.status,'completed',done.message);
    const item=await(await req('/api/items/'+done.item_id)).json(); assert.equal(item.source_url,data.url); assert.match(item.content,/原有说明\n\n来源链接/); assert.deepEqual(item.tags,['采集作者',...data.tags,'X']);assert.ok(item.content.includes('作者：[采集作者](<https://x.com/author>)'));assert.equal(item.title,'测试视频'); assert.ok(item.captured_at);
    assert.deepEqual(Buffer.from(await(await req(item.url)).arrayBuffer()),await readFile('tests/fixtures/sample.mp4'));
    const second=await(await post('/api/imports',{...data,url:'https://x.com/b/status/124'})).json(); assert.equal((await wait(second.id)).duplicate,true);
    const newer=await(await req('/api/items/'+item.id)).json(); assert.match(newer.content,/status\/123/); assert.match(newer.content,/status\/124/); assert.equal(newer.source_url,data.url); assert.equal((await readdir(join(dir,'media'))).length,1);
    const third=await(await post('/api/imports',{...data,url:'https://x.com/b/status/124'})).json(); await wait(third.id); assert.equal((await(await req('/api/items/'+item.id)).json()).version,newer.version);
    const failure=await(await post('/api/imports',{...data,url:'https://x.com/b/status/999'})).json(); assert.equal((await wait(failure.id)).status,'failed');
    const cancelled=await(await post('/api/imports',{...data,url:'https://x.com/b/status/125'})).json(); await req('/api/imports/'+cancelled.id,{method:'DELETE'}); assert.equal((await wait(cancelled.id)).status,'cancelled');
    const image=await sharp({create:{width:4,height:4,channels:3,background:'#789'}}).png().toBuffer(); const form=new FormData(); form.set('file',new Blob([image]),'source.png'); form.set('source_url','https://example.com/post'); form.set('content','图片说明');
    const pic=await(await req('/api/assets',{method:'POST',body:form})).json(); assert.match(pic.content,/图片说明\n\n来源链接：https:\/\/example.com\/post/);
    const saved=await runtime.backups.run(); const preview=await runtime.backups.preview(join(dir,'backups',saved.id));
    await post('/api/imports',{...data,url:'https://x.com/a/status/126'}); await runtime.backups.restore(preview.id);
    assert.ok(runtime.imports.list().some(j=>j.status==='cancelled')); assert.equal(runtime.db.prepare('SELECT count(*) n FROM items').get().n,2);
    const again=runtime.imports.add({...data,url:'https://x.com/a/status/127'}); for(let i=0;i<200&&runtime.imports.get(again.id).status!=='completed';i++)await delay(15);
    assert.equal(runtime.imports.get(again.id).status,'completed');
  } finally { await runtime.imports.stop(); await runtime.backups.stop(); await runtime.webhooks.stop(); await new Promise(r=>server.close(r)); runtime.db.close(); }
});
test('queue limits and shutdown do not save cancelled media', async()=>{
  const dir=await mkdtemp(resolve('artifacts/import-queue-'));let saves=0;
  const manager=createImportManager({dataDir:dir,downloader:fake,save:async()=>{saves++;return{id:'x'};}});
  for(let i=0;i<8;i++)manager.add({url:'https://x.com/a/status/'+(100+i),collection_id:null,tags:[]});
  assert.throws(()=>manager.add({url:'https://x.com/a/status/200'})); await delay(15); await manager.stop(); assert.equal(saves,0); assert.equal((await readdir(join(dir,'imports'))).length,0);
});
