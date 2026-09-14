import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import sharp from 'sharp';
import {createApp} from '../server/app.js';

test('note covers follow full Markdown order, summary requests and image lifecycle',async t=>{
  await mkdir(resolve('artifacts'),{recursive:true});
  const dataDir=await mkdtemp(resolve('artifacts/note-cover-'));
  const runtime=createApp({dataDir});
  const server=runtime.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  t.after(async()=>{await runtime.trash.stop();await runtime.imports.stop();await runtime.backups.stop();await runtime.webhooks.stop();await new Promise(r=>server.close(r));runtime.db.close();});
  const base=`http://127.0.0.1:${server.address().port}`;
  const setup=await fetch(base+'/api/auth/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'0427'})});
  const cookie=setup.headers.get('set-cookie').split(';')[0];
  const request=async(path,method='GET',data)=>{const r=await fetch(base+path,{method,headers:{Cookie:cookie,'Content-Type':'application/json'},body:data?JSON.stringify(data):undefined});assert.ok(r.ok,await r.clone().text());return r.json();};
  const library=await request('/api/collections','POST',{name:'Cover library'});
  const upload=async color=>{const form=new FormData();form.set('collection_id',library.id);form.set('file',new Blob([await sharp({create:{width:12,height:12,channels:3,background:color}}).png().toBuffer()],{type:'image/png'}),'cover.png');const r=await fetch(base+'/api/assets',{method:'POST',headers:{Cookie:cookie},body:form});assert.ok(r.ok);return r.json();};
  const first=await upload('red'),second=await upload('blue');
  let note=await request('/api/items','POST',{title:'Long note',collection_id:library.id,content:'text '.repeat(300)+`\n\n![first](${first.url})\n\n![second](${second.url})`});
  assert.equal(note.thumbnail_url,first.thumbnail_url);
  const list=await request(`/api/items?collection=${library.id}&kind=note&summary=true`);
  assert.equal(list.items.find(i=>i.id===note.id).thumbnail_url,first.thumbnail_url);
  note=await request(`/api/items/${note.id}`,'PATCH',{version:note.version,content:`![second][cover]\n\n![first](${first.url})\n\n[cover]: ${second.url}`});
  assert.equal(note.thumbnail_url,second.thumbnail_url);
  // Lifecycle checks must invalidate a cached cover even without editing note.
  runtime.db.prepare('UPDATE items SET deleted_at=? WHERE id=?').run(new Date().toISOString(),second.id);
  assert.equal((await request(`/api/items/${note.id}`)).thumbnail_url,null);
  runtime.db.prepare('UPDATE items SET deleted_at=NULL WHERE id=?').run(second.id);
  assert.equal((await request(`/api/items/${note.id}`)).thumbnail_url,second.thumbnail_url);
});
