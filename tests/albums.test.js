import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp} from 'node:fs/promises';
import {resolve} from 'node:path';
import express from 'express';
import {openDatabase} from '../server/db.js';
import {registerAlbums} from '../server/albums.js';

async function fixture(t) {
  const dir=await mkdtemp(resolve('artifacts/albums-unit-')),db=openDatabase(dir),app=express();app.use(express.json({limit:'2mb'}));
  const transaction=fn=>{db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}};
  registerAlbums({app,db,transaction,event:(type,id)=>db.prepare('INSERT INTO events(type,item_id,created_at) VALUES(?,?,?)').run(type,id,new Date().toISOString())});
  app.use((error,req,res,next)=>res.status(error.status||(error.name==='ZodError'?400:500)).json({error:error.message}));
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  t.after(async()=>{await new Promise(r=>server.close(r));db.close()});
  const base='http://127.0.0.1:'+server.address().port;
  async function request(path,method='GET',body,status=200) {
    const response=await fetch(base+path,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
    const result=response.status===204?null:await response.json();assert.equal(response.status,status,JSON.stringify(result));return result;
  }
  function library(name){const id=randomUUID();db.prepare('INSERT INTO collections VALUES(?,?,?,?)').run(id,name,'#287464','2026-10-11');return id;}
  function item(collection_id,kind='image',group_key=null){const id=randomUUID();db.prepare('INSERT INTO items(id,kind,title,collection_id,group_key,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(id,kind,'保留的原资源',collection_id,group_key,'2026-10-11','2026-10-11');return {id,version:1};}
  const create=(collection_id,name)=>request('/api/albums','POST',{collection_id,name},201);
  const preview=(collection_id,items)=>request('/api/favorite-targets/preview','POST',{collection_id,items});
  const save=(collection_id,snapshot,change={},status=200)=>request('/api/favorite-targets','POST',{collection_id,items:snapshot.items.map(({id,version})=>({id,version})),groups:snapshot.groups,...change},status);
  return {dir,db,request,library,item,create,preview,save};
}

test('albums create, rename and delete in separate libraries without a count limit or original deletion',async t=>{
  const f=await fixture(t),a=f.library('A'),b=f.library('B'),original=f.item(a,'note');
  let album=await f.create(a,'  灵感  ');assert.equal(album.name,'灵感');await f.create(b,'灵感');await f.create(null,'灵感');
  await f.request('/api/albums','POST',{collection_id:a,name:'灵感'},409);
  await f.request('/api/albums','POST',{collection_id:a,name:'  '},400);
  await f.request('/api/albums','POST',{collection_id:randomUUID(),name:'不存在'},404);
  await f.request('/api/albums/'+album.id,'PATCH',{name:'新名字',version:2},409);
  album=await f.request('/api/albums/'+album.id,'PATCH',{name:'新名字',version:1});assert.equal(album.version,2);
  const before=f.db.prepare('SELECT * FROM items WHERE id=?').get(original.id);
  const snapshot=await f.preview(a,[original]);await f.save(a,snapshot,{add:[album.id],favorite:true});
  await f.request('/api/albums/'+album.id,'DELETE',{version:1},409);
  const viewId=randomUUID();f.db.prepare('INSERT INTO saved_views VALUES(?,?,?,?,1,?,?)').run(viewId,a,'绑定相册的筛选',JSON.stringify({view:'favorites',album_id:album.id}),'2026-10-11','2026-10-11');
  await f.request('/api/albums/'+album.id,'DELETE',{version:2},204);
  assert.equal(JSON.parse(f.db.prepare('SELECT config FROM saved_views WHERE id=?').get(viewId).config).album_id,undefined);
  const after=f.db.prepare('SELECT * FROM items WHERE id=?').get(original.id);
  assert.equal(after.content,before.content);assert.equal(after.collection_id,a);assert.equal(after.favorite,1);assert.equal(after.deleted_at,null);assert.equal(f.db.prepare('SELECT count(*) n FROM album_items').get().n,0);
  const insert=f.db.prepare('INSERT INTO albums VALUES(?,?,?,1,?,?)');for(let i=0;i<75;i++)insert.run(randomUUID(),'相册 '+i,a,'2026-10-11','2026-10-11');
  await f.create(a,'第 76 个相册');assert.equal((await f.request('/api/albums?collection='+a)).albums.length,76);
  assert.equal((await f.request('/api/albums?collection=unfiled')).albums.length,1);
});

test('a group adds every member once, supports several albums and leaves grouping/order/files untouched',async t=>{
  const f=await fixture(t),library=f.library('组'),one=f.item(library,'video','same-group'),two=f.item(library,'video','same-group'),image=f.item(library,'image','same-group');
  const first=await f.create(library,'一'),second=await f.create(library,'二');
  const before=f.db.prepare('SELECT id,group_key,group_index,group_order,updated_at,file_key FROM items ORDER BY id').all();
  const snapshot=await f.preview(library,[{...one,group:true}]);assert.equal(snapshot.items.length,2);assert.equal(snapshot.groups.length,1);
  const saved=await f.save(library,snapshot,{add:[first.id,second.id],favorite:true});assert.equal(saved.changed_count,2);
  assert.deepEqual(f.db.prepare('SELECT id,group_key,group_index,group_order,updated_at,file_key FROM items ORDER BY id').all(),before);
  assert.equal(f.db.prepare('SELECT count(*) n FROM album_items').get().n,4);assert.equal(f.db.prepare('SELECT favorite FROM items WHERE id=?').get(image.id).favorite,0);
  assert.deepEqual((await f.request('/api/albums?collection='+library)).albums.map(row=>row.card_count),[1,1]);
  const fresh=await f.preview(library,[{...one,group:true}]);assert.equal(fresh.favorite_count,2);assert.ok(fresh.albums.every(album=>album.selected_count===2));
  assert.equal((await f.save(library,fresh,{add:[first.id,second.id],favorite:true})).changed_count,0);
  await f.save(library,fresh,{remove:[first.id],favorite:false});assert.equal(f.db.prepare('SELECT count(*) n FROM album_items').get().n,2);
});

test('partial selection preserves untouched memberships and moving/trashing does not leak into other scopes',async t=>{
  const f=await fixture(t),a=f.library('原库'),b=f.library('目标库'),one=f.item(a,'image','group'),two=f.item(a,'image','group'),album=await f.create(a,'部分');
  await f.save(a,await f.preview(a,[one]),{add:[album.id]});
  const whole=await f.preview(a,[{...one,group:true}]);assert.equal(whole.albums[0].selected_count,1);
  await f.save(a,whole,{favorite:true});assert.equal(f.db.prepare('SELECT count(*) n FROM album_items').get().n,1);
  f.db.prepare('UPDATE items SET collection_id=? WHERE id=?').run(b,one.id);assert.equal((await f.request('/api/albums?collection='+a)).albums[0].card_count,0);
  await f.request('/api/favorite-targets/preview','POST',{collection_id:a,items:[one]},409);
  await f.save(b,await f.preview(b,[one]),{add:[album.id]},409);
  f.db.prepare('UPDATE items SET collection_id=?,deleted_at=? WHERE id=?').run(a,'2026-10-11',one.id);assert.equal((await f.request('/api/albums?collection='+a)).albums[0].card_count,0);
  f.db.prepare('UPDATE items SET deleted_at=NULL WHERE id=?').run(one.id);assert.equal((await f.request('/api/albums?collection='+a)).albums[0].card_count,1);
  f.db.prepare('DELETE FROM items WHERE id=?').run(one.id);assert.equal(f.db.prepare('SELECT count(*) n FROM album_items').get().n,0);assert.ok(f.db.prepare('SELECT id FROM items WHERE id=?').get(two.id));
});

test('concurrent edits, group additions and deleted targets fail atomically and can be previewed again',async t=>{
  const f=await fixture(t),library=f.library('冲突'),one=f.item(library,'image','group'),two=f.item(library,'image','group'),album=await f.create(library,'目标');
  let snapshot=await f.preview(library,[{...one,group:true}]);
  f.item(library,'image','group');await f.save(library,snapshot,{add:[album.id],favorite:true},409);
  assert.equal(f.db.prepare('SELECT count(*) n FROM album_items').get().n,0);assert.equal(f.db.prepare('SELECT sum(favorite) n FROM items').get().n,0);
  snapshot=await f.preview(library,[{...one,group:true}]);f.db.prepare('UPDATE items SET version=version+1 WHERE id=?').run(two.id);
  await f.save(library,snapshot,{add:[album.id]},409);assert.equal(f.db.prepare('SELECT count(*) n FROM album_items').get().n,0);
  snapshot=await f.preview(library,[{...one,group:true}]);await f.save(library,snapshot,{add:[album.id],remove:[album.id]},400);
  await f.request('/api/albums/'+album.id,'DELETE',{version:album.version},204);await f.save(library,snapshot,{add:[album.id]},404);
  const newAlbum=await f.create(library,'重新选择');await f.save(library,await f.preview(library,[{...one,group:true}]),{add:[newAlbum.id]});assert.equal(f.db.prepare('SELECT count(*) n FROM album_items').get().n,3);
});

test('schema 14 migrates additively, membership persists on reopen, and library deletion cascades only classification',async t=>{
  const dir=await mkdtemp(resolve('artifacts/albums-migration-'));let db=openDatabase(dir);
  const id=randomUUID(),library=randomUUID(),album=randomUUID();db.prepare('INSERT INTO collections VALUES(?,?,?,?)').run(library,'原库','#287464','2026-10-11');
  db.prepare("INSERT INTO items(id,kind,title,collection_id,created_at,updated_at) VALUES(?,'note','旧笔记',?,'2026-10-11','2026-10-11')").run(id,library);
  const before=db.prepare('SELECT * FROM items').all();db.exec('DROP TABLE album_items; DROP TABLE albums; PRAGMA user_version=14');db.close();
  db=openDatabase(dir);assert.equal(db.prepare('PRAGMA user_version').get().user_version,15);assert.deepEqual(db.prepare('SELECT * FROM items').all(),before);
  db.prepare('INSERT INTO albums VALUES(?,?,?,1,?,?)').run(album,'持久收藏',library,'2026-10-11','2026-10-11');db.prepare('INSERT INTO album_items VALUES(?,?)').run(album,id);db.close();
  db=openDatabase(dir);assert.equal(db.prepare('SELECT count(*) n FROM album_items').get().n,1);db.prepare('DELETE FROM collections WHERE id=?').run(library);
  assert.equal(db.prepare('SELECT count(*) n FROM albums').get().n,0);assert.equal(db.prepare('SELECT count(*) n FROM album_items').get().n,0);assert.equal(db.prepare('SELECT title FROM items WHERE id=?').get(id).title,'旧笔记');assert.equal(db.prepare('SELECT collection_id FROM items WHERE id=?').get(id).collection_id,null);db.close();
});
