import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createApp} from '../server/app.js';

test('card totals collapse images, scope libraries and count partially favorited groups once',async t=>{
  await mkdir(resolve('artifacts'),{recursive:true});
  const runtime=createApp({dataDir:await mkdtemp(resolve('artifacts/card-counts-'))});
  const server=runtime.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  t.after(async()=>{await runtime.trash.stop();await runtime.imports.stop();await runtime.backups.stop();await runtime.webhooks.stop();await new Promise(r=>server.close(r));runtime.db.close();});
  const base=`http://127.0.0.1:${server.address().port}`;
  const setup=await fetch(base+'/api/auth/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'0427'})});
  const cookie=setup.headers.get('set-cookie').split(';')[0];
  const get=async path=>{const r=await fetch(base+path,{headers:{Cookie:cookie}});assert.ok(r.ok);return r.json();};
  const date=new Date().toISOString();
  for(const id of ['a','b'])runtime.db.prepare('INSERT INTO collections(id,name,color,created_at) VALUES(?,?,?,?)').run(id,id,'#888888',date);
  const insert=runtime.db.prepare('INSERT INTO items(id,kind,title,collection_id,group_key,favorite,deleted_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)');
  for(const [id,kind,library,group,favorite,deleted] of [
    ['a1','image','a','shared',1,null],['a2','image','a','shared',0,null],
    ['a3','image','a',null,0,null],['a4','note','a',null,1,null],['a5','video','a',null,0,null],
    ['b1','image','b','shared',1,null],['u1','image',null,'shared',0,null],['u2','image',null,'shared',0,null],
    ['trash','image','a','trash-group',1,date],
  ])insert.run(id,kind,id,library,group,favorite,deleted,date,date);
  const stats=await get('/api/stats?collection=a');
  assert.equal(stats.total,5);assert.equal(stats.total_cards,4);assert.equal(stats.image_cards,2);assert.equal(stats.favorite_cards,2);
  runtime.db.prepare('UPDATE items SET favorite=1 WHERE id=?').run('a2');
  assert.equal((await get('/api/stats?collection=a')).favorite_cards,2);
  assert.equal((await get('/api/stats?collection=unfiled')).total_cards,1);
  assert.equal((await get('/api/stats')).total_cards,6);
  const libraries=await get('/api/collections');
  assert.equal(libraries.find(c=>c.id==='a').card_count,4);assert.equal(libraries.find(c=>c.id==='a').count,5);
  assert.equal(libraries.find(c=>c.id==='b').card_count,1);
});
