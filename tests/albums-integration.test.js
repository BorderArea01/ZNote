import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createApp} from '../server/app.js';

test('real item lists, access control, exports and snapshot restoration preserve album membership and old favorites',async t=>{
  const dir=await mkdtemp(resolve('artifacts/albums-api-'));const runtime=createApp({dataDir:dir}),server=runtime.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  async function close(value){await value.trash.stop();await value.imports.stop();await value.backups.stop();await value.webhooks.stop();value.db.close();}
  t.after(async()=>{await new Promise(r=>server.close(r));await close(runtime)});
  const base='http://127.0.0.1:'+server.address().port;let cookie;
  const request=(path,method='GET',body,headers={})=>fetch(base+path,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{}),...headers},body:body?JSON.stringify(body):undefined});
  async function json(path,method='GET',body){const response=await request(path,method,body);assert.ok(response.ok,await response.clone().text());return response.status===204?null:response.json();}
  assert.equal((await request('/api/albums')).status,401);
  const setup=await request('/api/auth/setup','POST',{password:'1117'});cookie=setup.headers.get('set-cookie').split(';')[0];
  const library=await json('/api/collections','POST',{name:'相册 API 验收'}),other=await json('/api/collections','POST',{name:'其他库'});
  const a=await json('/api/items','POST',{title:'A',content:'正文原样保留',collection_id:library.id}),b=await json('/api/items','POST',{title:'B',collection_id:library.id,favorite:true}),foreign=await json('/api/items','POST',{title:'其他库笔记',collection_id:other.id});
  const album=await json('/api/albums','POST',{name:'相册',collection_id:library.id});
  const snapshot=await json('/api/favorite-targets/preview','POST',{collection_id:library.id,items:[{id:a.id,version:a.version}]});
  const membership=await json('/api/favorite-targets','POST',{collection_id:library.id,items:snapshot.items.map(({id,version})=>({id,version})),add:[album.id]});assert.equal(membership.items[0].version,a.version+1);assert.deepEqual(membership.items[0].tags,a.tags);assert.equal(membership.items[0].title,a.title);assert.ok(membership.items[0].summary);assert.deepEqual(membership.items[0].album_ids,[album.id]);
  const scoped=await json('/api/items?album='+album.id+'&grouped=true&summary=true&sort=title&direction=asc');assert.equal(scoped.total,1);assert.deepEqual(scoped.items.map(row=>row.id),[a.id]);assert.deepEqual(scoped.items[0].album_ids,[album.id]);
  assert.equal((await request('/api/items?collection='+other.id+'&album='+album.id)).status,400);
  assert.deepEqual((await json('/api/items?collection='+library.id+'&favorite=true')).items.map(row=>row.id),[b.id]);
  assert.equal((await json('/api/items/'+a.id)).content,a.content);assert.deepEqual((await json('/api/items/'+foreign.id)).album_ids,[]);
  const readonly=await json('/api/tokens','POST',{name:'只读',scope:'read'});
  const defaultSnapshot=await json('/api/favorite-targets/preview','POST',{collection_id:library.id,items:[{id:b.id,version:b.version}]});
  const defaultChange=await json('/api/favorite-targets','POST',{collection_id:library.id,items:defaultSnapshot.items.map(({id,version})=>({id,version})),favorite:false,undo:true});assert.ok(defaultChange.undo);assert.equal((await json('/api/items/'+b.id)).favorite,false);await json('/api/undo/'+defaultChange.undo.id,'POST',{});assert.equal((await json('/api/items/'+b.id)).favorite,true);
  assert.equal((await request('/api/albums','POST',{name:'不能写',collection_id:library.id},{Authorization:'Bearer '+readonly.token})).status,403);
  const manifest=await json('/api/export?mode=json&collection='+library.id);assert.deepEqual(manifest.albums.map(row=>row.id),[album.id]);assert.deepEqual(manifest.album_items.map(row=>row.item_id),[a.id]);
  const config={view:'favorites',album_id:album.id,query:'',tags:[],mode:'all',sort:'title',direction:'asc',layout:'compact-grid'};
  const savedView=await json('/api/saved-views','POST',{name:'相册常用筛选',collection_id:library.id,config});assert.equal(savedView.config.album_id,album.id);
  assert.equal((await request('/api/saved-views','POST',{name:'跨库筛选',collection_id:other.id,config})).status,400);
  const response=await request('/api/export?mode=backup');assert.equal(response.status,200);const archive=join(dir,'snapshot.zip');await writeFile(archive,Buffer.from(await response.arrayBuffer()));
  const target=createApp({dataDir:join(dir,'restore')});
  try{const preview=await target.backups.preview(archive);await target.backups.restore(preview.id);assert.deepEqual(target.db.prepare('SELECT * FROM albums ORDER BY id').all(),runtime.db.prepare('SELECT * FROM albums ORDER BY id').all());assert.deepEqual(target.db.prepare('SELECT * FROM album_items ORDER BY album_id,item_id').all(),runtime.db.prepare('SELECT * FROM album_items ORDER BY album_id,item_id').all());assert.equal(target.db.prepare('SELECT content FROM items WHERE id=?').get(a.id).content,a.content);assert.equal(target.db.prepare('SELECT favorite FROM items WHERE id=?').get(b.id).favorite,1);assert.equal(target.db.prepare('PRAGMA user_version').get().user_version,15);}finally{await close(target)}
  // Restoring an older database removes newer album associations rather than
  // leaving references to items that no longer exist in the restored snapshot.
  const legacyDir=join(dir,'legacy');const legacy=createApp({dataDir:legacyDir});
  try{legacy.db.exec('DROP TABLE album_items; DROP TABLE albums; PRAGMA user_version=14');const legacyResponse=await new Promise((resolve,reject)=>{const service=legacy.app.listen(0,'127.0.0.1',async()=>{try{const login=await fetch('http://127.0.0.1:'+service.address().port+'/api/auth/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'1117'})});const r=await fetch('http://127.0.0.1:'+service.address().port+'/api/export?mode=backup',{headers:{Cookie:login.headers.get('set-cookie').split(';')[0]}});const bytes=Buffer.from(await r.arrayBuffer());service.close(()=>resolve(bytes));}catch(e){service.close(()=>reject(e))}})});const legacyPath=join(dir,'legacy.zip');await writeFile(legacyPath,legacyResponse);const p=await runtime.backups.preview(legacyPath);await runtime.backups.restore(p.id);assert.equal(runtime.db.prepare('SELECT count(*) n FROM albums').get().n,0);assert.equal(runtime.db.prepare('SELECT count(*) n FROM album_items').get().n,0);}finally{await close(legacy)}
});
