import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createApp} from '../server/app.js';

test('list sorting supports direction, stable type sections and single-image gallery scope',async t=>{
  const dir=await mkdtemp(resolve('artifacts/sorting-')),runtime=createApp({dataDir:dir}),server=runtime.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  t.after(async()=>{await runtime.trash.stop();await runtime.imports.stop();await runtime.backups.stop();await runtime.webhooks.stop();await new Promise(r=>server.close(r));runtime.db.close()});
  const base='http://127.0.0.1:'+server.address().port,setup=await fetch(base+'/api/auth/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'0951'})}),cookie=setup.headers.get('set-cookie').split(';')[0];
  const request=path=>fetch(base+path,{headers:{Cookie:cookie}}),json=async path=>{const r=await request(path);assert.ok(r.ok,await r.clone().text());return r.json()};
  const library=(await (await fetch(base+'/api/collections',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({name:'排序验收'})})).json()).id;
  const rows=[];const add=(kind,title,group_key=null,group_index=0)=>{const id=randomUUID(),date=`2026-01-0${rows.length+1}T00:00:00.000Z`;runtime.db.prepare('INSERT INTO items(id,kind,title,content,collection_id,group_key,group_title,group_index,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,kind,title,'',library,group_key,group_key?'组乙':null,group_index,date,date);rows.push({id,kind,title,group_key});return id};
  const singleA=add('image','单图甲'),singleB=add('image','单图乙'),groupA=add('image','组内一','album:test',0),groupB=add('image','组内二','album:test',1),note=add('note','笔记甲'),video=add('video','视频甲');
  const scope='collection='+library+'&grouped=true&sort=title';
  assert.deepEqual((await json('/api/items?'+scope+'&direction=asc')).items.map(i=>i.title),['单图乙','单图甲','笔记甲','组内一','视频甲']);
  assert.deepEqual((await json('/api/items?'+scope+'&direction=desc')).items.map(i=>i.title),['视频甲','组内一','笔记甲','单图甲','单图乙']);
  const typed=(await json('/api/items?'+scope+'&direction=asc&type_group=true')).items;
  assert.deepEqual(typed.map(i=>i.id),[singleB,singleA,groupA,note,video]);
  assert.deepEqual((await json('/api/items?collection='+library+'&gallery=true&gallery_scope=singles&sort=title&direction=asc')).ids,[singleB,singleA]);
  assert.equal((await request('/api/items?direction=DROP')).status,400);
  assert.ok(!typed.some(i=>i.id===groupB));
});
