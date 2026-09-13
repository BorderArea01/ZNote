import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createApp} from '../server/app.js';
import {openDatabase} from '../server/db.js';
test('video positions survive restart and backup, isolate libraries, reject conflicts and preserve media',async t=>{
  const dir=await mkdtemp(resolve('artifacts/video-progress-'));let runtime,server,base,cookie;
  const start=async()=>{runtime=createApp({dataDir:dir});server=runtime.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base='http://127.0.0.1:'+server.address().port;};
  const stop=async()=>{await runtime.imports.stop();await runtime.backups.stop();await runtime.trash.stop();await runtime.webhooks.stop();await new Promise(r=>server.close(r));runtime.db.close();};await start();t.after(stop);
  const req=(path,method='GET',data,headers={})=>fetch(base+path,{method,headers:{Cookie:cookie||'','content-type':'application/json',...headers},body:data?JSON.stringify(data):undefined});
  const json=async(...args)=>{const r=await req(...args);assert.ok(r.ok,await r.clone().text());return r.json();};
  const setup=await req('/api/auth/setup','POST',{password:'0925'});cookie=setup.headers.get('set-cookie').split(';')[0];
  const a=await json('/api/collections','POST',{name:'视频库'}),b=await json('/api/collections','POST',{name:'别的库'});
  const original=await readFile(resolve('tests/fixtures/sample.mp4')),form=new FormData();form.set('file',new Blob([original]),'sample.mp4');form.set('collection_id',a.id);const uploaded=await fetch(base+'/api/videos',{method:'POST',headers:{Cookie:cookie},body:form});assert.equal(uploaded.status,201);const first=await uploaded.json();
  const row=runtime.db.prepare('SELECT * FROM items WHERE id=?').get(first.id),cols=Object.keys(row),insert=runtime.db.prepare(`INSERT INTO items(${cols.join(',')}) VALUES(${cols.map(()=>'?').join(',')})`),ids=[first.id];
  for(let i=1;i<24;i++){const copy={...row,id:randomUUID(),title:'视频 '+i};insert.run(...cols.map(c=>copy[c]));ids.push(copy.id);}
  const before=runtime.db.prepare('SELECT * FROM items ORDER BY id').all(),events=runtime.db.prepare('SELECT * FROM events').all();
  const read=()=>json('/api/video-progress?collection='+a.id),body=(s,id=first.id,position=0.5)=>({collection_id:a.id,version:s.version,epoch:s.epoch,request_id:randomUUID(),item_id:id,position,duration:row.duration,completed:false});
  let state=await read();const input=body(state);state=await json('/api/video-progress','POST',input);assert.equal(state.entries[0].position,0.5);assert.equal((await json('/api/video-progress','POST',input)).replayed,true);
  assert.equal((await req('/api/video-progress','POST',{...input,position:0.6})).status,409);assert.equal((await req('/api/video-progress','POST',body({version:0,epoch:state.epoch}))).status,409);
  assert.equal((await req('/api/video-progress','POST',{...body(state),collection_id:b.id,version:0})).status,409);assert.equal((await json('/api/video-progress?collection='+b.id)).entries.length,0);
  assert.equal((await req('/api/video-progress','POST',body(state,first.id,row.duration+5))).status,400);
  state=await json('/api/video-progress','POST',{...body(state,first.id,row.duration),completed:true});assert.equal(state.entries[0].completed,true);state=await json('/api/video-progress','POST',body(state,first.id,0));assert.equal(state.entries[0].completed,false);
  for(const id of ids)state=await json('/api/video-progress','POST',body(state,id));assert.equal(state.entries.length,20);
  assert.deepEqual(runtime.db.prepare('SELECT * FROM items ORDER BY id').all(),before);assert.deepEqual(runtime.db.prepare('SELECT * FROM events').all(),events);assert.deepEqual(await readFile(join(dir,'media',row.file_key)),original);
  const last=ids.at(-1);runtime.db.prepare('UPDATE items SET deleted_at=? WHERE id=?').run(new Date().toISOString(),last);assert.ok(!(await read()).entries.some(e=>e.item_id===last));runtime.db.prepare('UPDATE items SET deleted_at=NULL,collection_id=? WHERE id=?').run(b.id,last);assert.ok(!(await read()).entries.some(e=>e.item_id===last));runtime.db.prepare('UPDATE items SET collection_id=? WHERE id=?').run(a.id,last);
  const token=await json('/api/tokens','POST',{name:'只读',scope:'read'});assert.equal((await req('/api/video-progress','POST',body(state),{Authorization:'Bearer '+token.token})).status,403);
  await stop();await start();assert.deepEqual(await read(),state);
  const archive=join(dir,'full.zip');await writeFile(archive,Buffer.from(await(await req('/api/export?mode=backup')).arrayBuffer()));const restore=createApp({dataDir:join(dir,'restore')});
  try{const p=await restore.backups.preview(archive);await restore.backups.restore(p.id);assert.deepEqual(restore.db.prepare('SELECT * FROM video_progress').all(),runtime.db.prepare('SELECT * FROM video_progress').all());assert.notEqual(restore.db.prepare("SELECT value FROM settings WHERE key='reading_epoch'").get().value,state.epoch);}finally{await restore.trash.stop();await restore.imports.stop();await restore.backups.stop();await restore.webhooks.stop();restore.db.close();}
  const clear={collection_id:a.id,version:state.version,epoch:state.epoch,request_id:randomUUID()};state=await json('/api/video-progress','DELETE',clear);assert.equal(state.entries.length,0);assert.equal((await json('/api/video-progress','DELETE',clear)).replayed,true);assert.equal((await req('/api/video-progress','POST',input)).status,409);assert.equal((await req('/api/video-progress','POST',{...body(state),epoch:'old-restore'})).status,409);
});
test('schema 12 upgrades video progress without changing image history or original rows',async()=>{
  const dir=await mkdtemp(resolve('artifacts/video-migration-'));let db=openDatabase(dir);db.exec('DROP TABLE video_progress; PRAGMA user_version=12');db.prepare("INSERT INTO items(id,kind,title,content,created_at,updated_at) VALUES(?,'note','原笔记','原文','2026-09-13','2026-09-13')").run(randomUUID());const rows=db.prepare('SELECT * FROM items').all(),epoch=db.prepare("SELECT value FROM settings WHERE key='reading_epoch'").get().value;db.close();db=openDatabase(dir);assert.equal(db.prepare('PRAGMA user_version').get().user_version,13);assert.deepEqual(db.prepare('SELECT * FROM items').all(),rows);assert.equal(db.prepare('SELECT count(*) n FROM video_progress').get().n,0);assert.equal(db.prepare("SELECT value FROM settings WHERE key='reading_epoch'").get().value,epoch);db.close();db=openDatabase(dir);assert.equal(db.prepare('PRAGMA user_version').get().user_version,13);db.close();
});
