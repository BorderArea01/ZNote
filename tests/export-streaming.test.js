import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,unlink} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {Readable,Writable} from 'node:stream';
import {finished} from 'node:stream/promises';
import express from 'express';
import {exportContent} from '../server/exports.js';
import {originalStream} from '../server/storage.js';
import {registerExportJobs} from '../server/export-jobs.js';
import {createApp} from '../server/app.js';
const until=async fn=>{for(let n=0;n<200;n++){if(await fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('State did not settle');};

test('large export reads one original at a time, honors slow destinations and releases on disconnect',async()=>{
  const dir=await mkdtemp(resolve('artifacts/export-stream-'));await mkdir(join(dir,'media'));
  const payload=randomBytes(512*1024);await writeFile(join(dir,'media/raw'),payload);await writeFile(join(dir,'media/packed'),gzipSync(payload));
  const rows=Array.from({length:48},(_,i)=>({id:'item-'+i,kind:'image',mime:'image/png',title:'图片 '+i,tags:'[]',content:'',collection_id:null,storage_codec:i%2?'gzip':'identity',file_key:i%2?'packed':'raw'}));
  const db={prepare:sql=>({all:()=>sql.includes('collections')?[]:rows})};
  let active=0,peak=0,opened=0,closed=0;
  const readOriginal=(dir,item)=>Readable.from((async function*(){opened++;active++;peak=Math.max(peak,active);const hash=createHash('sha256');try{for await(const chunk of originalStream(dir,item)){hash.update(chunk);yield chunk;}assert.equal(hash.digest('hex'),createHash('sha256').update(payload).digest('hex'));}finally{active--;closed++;}})());
  let received=0,progress,chunks=0;
  const output=new Writable({highWaterMark:8192,write(chunk,encoding,done){received+=chunk.length;if(++chunks%32===0)setTimeout(done,1);else setImmediate(done);}});output.attachment=()=>output;
  await exportContent({db,dir,req:{query:{mode:'images'}},res:output,serialize:r=>r,readOriginal,progress:v=>progress=v});await finished(output);
  assert.equal(peak,1);assert.equal(opened,48);assert.equal(closed,48);assert.ok(received>24*1024*1024);assert.equal(progress.bytes,received);assert.equal(progress.entries,97);
  opened=closed=peak=active=0;
  const broken=new Writable({highWaterMark:8192,write(chunk,enc,done){setImmediate(()=>{this.destroy();done();});}});broken.attachment=()=>broken;
  await assert.rejects(exportContent({db,dir,req:{query:{mode:'images'}},res:broken,serialize:r=>r,readOriginal}));await until(()=>active===0);assert.ok(opened<48);assert.equal(opened,closed);
});

test('native export receipts enforce one stream, cancellation, bounded history, retries and expiry',async t=>{
  let time=Date.now(),released;const gate=new Promise(r=>released=r);
  const app=express();app.use(express.json());let started=0;
  const manager=registerExportJobs({app,db:{prepare:()=>({get:()=>({id:'library'})})},admin:(req,res,next)=>next(),clock:()=>time,streamExport:async(req,res,progress)=>{
    started++;if(req.query.collection==='hold')await gate;
    if(res.destroyed)return;
    if(req.query.collection==='active-cancel'){res.attachment('fixture.zip');res.write('start');await new Promise(r=>res.once('close',r));return;}
    res.attachment('fixture.json');progress({bytes:2,entries:1});res.end('{}');
  }});
  app.use((e,req,res,next)=>res.status(e.status||500).json({error:e.message}));
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));
  const base='http://127.0.0.1:'+server.address().port;
  const req=(path,method='GET',body)=>fetch(base+path,{method,headers:{'content-type':'application/json'},body:body?JSON.stringify(body):undefined});
  const add=async query=>(await req('/api/export-jobs','POST',query)).json();const list=async()=>(await(await req('/api/export-jobs')).json()).jobs;
  const held=await add({mode:'json',collection:'hold'});assert.equal((await req(held.download_url,'HEAD')).status,204);
  const first=req(held.download_url).catch(()=>null);await until(()=>started===1);
  const second=await add({mode:'json',collection:'other'});const pending=req(second.download_url).catch(()=>null);await until(()=>manager.diagnostics().pending===1);
  assert.equal((await req(held.download_url)).status,409);await req('/api/export-jobs/'+second.id,'DELETE');released();await first;await pending;await until(()=>manager.diagnostics().active===0);assert.equal(started,1);
  const retry=await(await req('/api/export-jobs/'+second.id+'/retry','POST',{})).json();assert.equal(retry.collection_id,'other');assert.equal((await(await req('/api/export-jobs/'+second.id+'/retry','POST',{})).json()).id,retry.id);
  assert.equal(await(await req(retry.download_url)).text(),'{}');await until(async()=>(await list()).find(j=>j.id===retry.id)?.status==='completed');assert.equal(started,2);
  const activeJob=await add({mode:'portable',collection:'active-cancel'}),response=await req(activeJob.download_url);
  await req('/api/export-jobs/'+activeJob.id,'DELETE');await assert.rejects(response.arrayBuffer());await until(()=>manager.diagnostics().active===0);assert.equal((await list()).find(j=>j.id===activeJob.id).status,'cancelled');
  const stale=await add({mode:'portable'});time+=300001;assert.equal((await list()).find(j=>j.id===stale.id).status,'failed');
  for(let i=0;i<55;i++){const j=await add({mode:'json'});await req('/api/export-jobs/'+j.id,'DELETE');}assert.equal((await list()).length,50);
  for(let i=0;i<20;i++)await add({mode:'json'});assert.equal((await req('/api/export-jobs','POST',{mode:'json'})).status,429);
  manager.clear();assert.equal((await list()).length,0);assert.equal((await req(stale.download_url)).status,404);
});

test('export receipts require admin, preserve library scope, report missing originals and recover via retry',async t=>{
  const dir=await mkdtemp(resolve('artifacts/export-api-')),runtime=createApp({dataDir:dir}),server=runtime.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  t.after(async()=>{await runtime.imports.stop();await runtime.backups.stop();await runtime.webhooks.stop();await runtime.trash.stop();await new Promise(r=>server.close(r));runtime.db.close();});
  const base='http://127.0.0.1:'+server.address().port;
  assert.equal((await fetch(base+'/api/export-jobs')).status,401);
  const setup=await fetch(base+'/api/auth/setup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:'0924'})});const headers={Cookie:setup.headers.get('set-cookie').split(';')[0],'content-type':'application/json'};
  const req=(path,method='GET',body)=>fetch(base+path,{method,headers,body:body?JSON.stringify(body):undefined});
  const json=async(path,method,body)=>{const r=await req(path,method,body);assert.ok(r.ok,await r.clone().text());return r.json();};
  const a=await json('/api/collections','POST',{name:'导出库'}),b=await json('/api/collections','POST',{name:'其他库'});
  await json('/api/items','POST',{title:'导出笔记',content:'[来源](https://example.com)',collection_id:a.id});await json('/api/items','POST',{title:'不可混入',collection_id:b.id});
  const token=await json('/api/tokens','POST',{name:'readonly',scope:'read'});assert.equal((await fetch(base+'/api/export-jobs',{headers:{Authorization:'Bearer '+token.token}})).status,403);
  assert.equal((await req('/api/export-jobs','POST',{mode:'unknown'})).status,400);assert.equal((await req('/api/export-jobs','POST',{collection:'missing'})).status,404);
  const job=await json('/api/export-jobs','POST',{mode:'json',collection:a.id,include_trash:'false'});assert.equal(job.collection_id,a.id);assert.equal(job.global,false);assert.ok(!('query' in job));
  const manifest=await json(job.download_url);assert.equal(manifest.items.length,1);assert.equal(manifest.items[0].title,'导出笔记');
  const sharp=(await import('sharp')).default,buffer=await sharp({create:{width:16,height:16,channels:3,background:'#abcdef'}}).png().toBuffer(),form=new FormData();form.set('file',new Blob([buffer]),'source.png');form.set('collection_id',a.id);
  const image=await(await fetch(base+'/api/assets',{method:'POST',headers:{Cookie:headers.Cookie},body:form})).json();const row=runtime.db.prepare('SELECT * FROM items WHERE id=?').get(image.id),path=join(dir,'media',row.file_key);await unlink(path);
  const bad=await json('/api/export-jobs','POST',{mode:'images',collection:a.id});await assert.rejects(async()=>{const r=await req(bad.download_url);if(!r.ok)throw Error();await r.arrayBuffer();});
  await until(async()=>(await json('/api/export-jobs')).jobs.find(j=>j.id===bad.id)?.status==='failed');
  await writeFile(path,row.storage_codec==='gzip'?gzipSync(buffer):buffer);const retry=await json('/api/export-jobs/'+bad.id+'/retry','POST',{});assert.equal(retry.collection_id,a.id);assert.ok((await(await req(retry.download_url)).arrayBuffer()).byteLength>100);
  const waiting=await json('/api/export-jobs','POST',{mode:'json',collection:a.id}),archive=join(dir,'restore.zip');await writeFile(archive,Buffer.from(await(await req('/api/export?mode=backup')).arrayBuffer()));
  const preview=await runtime.backups.preview(archive);await runtime.backups.restore(preview.id);
  const login=await req('/api/auth/login','POST',{password:'0924'});headers.Cookie=login.headers.get('set-cookie').split(';')[0];assert.equal((await json('/api/export-jobs')).jobs.length,0);assert.equal((await req(waiting.download_url)).status,404);
});
