import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import sharp from 'sharp';
import { createApp } from '../server/app.js';

test('image groups preserve page identity, share bytes, scope libraries and survive full restore', async t => {
  const dir=await mkdtemp(resolve('artifacts/groups-')), runtime=createApp({dataDir:join(dir,'data')});
  const server=runtime.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  t.after(async()=>{await runtime.imports.stop();await runtime.backups.stop();await runtime.webhooks.stop();await new Promise(r=>server.close(r));runtime.db.close()});
  const base='http://127.0.0.1:'+server.address().port;
  const setup=await fetch(base+'/api/auth/setup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:'0922'})});const cookie=setup.headers.get('set-cookie').split(';')[0];
  const request=(path,method='GET',body)=>fetch(base+path,{method,headers:{Cookie:cookie,...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
  const json=async(...args)=>{const r=await request(...args);assert.ok(r.ok,await r.clone().text());return r.json()};
  const a=await json('/api/collections','POST',{name:'漫画'}),b=await json('/api/collections','POST',{name:'备选'});
  const bytes=await sharp({create:{width:64,height:48,channels:3,background:'#6655aa'}}).png().toBuffer();
  const upload=async(index,collection=a.id,mode='work',id='12345')=>{
    const form=new FormData();form.set('file',new Blob([bytes]),'page.png');form.set('collection_id',collection);form.set('title','分镜 '+index);form.set('tags',JSON.stringify(['Pixiv','测试作者']));form.set('source_url','https://www.pixiv.net/artworks/'+id);form.set('group_key',mode==='work'?'pixiv:art:'+id:'');form.set('group_index',index);form.set('group_title','测试漫画');
    const r=await fetch(base+'/api/assets',{method:'POST',headers:{Cookie:cookie},body:form});assert.ok(r.ok,await r.clone().text());return r.json();
  };
  const pages=[await upload(2),await upload(0),await upload(1)];
  assert.equal(new Set(pages.map(p=>p.id)).size,3,'identical pages retain order and identity');
  assert.equal((await readdir(join(dir,'data','media'))).length,1,'one physical original');
  assert.equal((await upload(1)).id,pages[2].id,'retries retain identity');
  const grouped=await json('/api/items?collection='+a.id+'&grouped=true');assert.equal(grouped.total,1);assert.equal(grouped.items[0].id,pages[1].id);assert.equal(grouped.items[0].group_count,3);assert.equal(grouped.items[0].group_size,3);const filtered=await json('/api/items?collection='+a.id+'&grouped=true&q='+encodeURIComponent('分镜 0'));assert.equal(filtered.items[0].group_count,1);assert.equal(filtered.items[0].group_size,3);
  assert.equal((await json('/api/items?collection='+a.id)).total,3,'flat API remains compatible');
  assert.deepEqual((await json('/api/items?collection='+a.id+'&group_key=pixiv:art:12345&gallery=true')).ids,[pages[1].id,pages[2].id,pages[0].id]);
  await upload(0,b.id);assert.equal((await json('/api/items?collection='+b.id+'&grouped=true')).items[0].group_count,1);assert.equal((await json('/api/items?collection='+b.id+'&grouped=true')).items[0].group_size,1);
  assert.equal((await json('/api/items?grouped=true')).total,2,'same work remains separate between libraries');
  await json('/api/item-groups/favorite','POST',{collection_id:a.id,group_key:'pixiv:art:12345',favorite:true});assert.equal((await json('/api/items?collection='+a.id+'&favorite=true')).total,3);
  assert.equal((await json('/api/items?collection='+b.id)).items[0].favorite,false);
  for(const p of pages){const current=await json('/api/items/'+p.id);await json('/api/items/'+p.id+'/copy','POST',{collection_id:null});assert.equal(current.group_key,'pixiv:art:12345')}
  assert.equal((await json('/api/items?collection=unfiled&grouped=true')).items[0].group_count,3,'copy preserves byte-identical pages');
  const c=await json('/api/collections','POST',{name:'移动目标'});
  const unfiled=(await json('/api/items?collection=unfiled')).items;
  await json('/api/items/batch-organize','POST',{items:unfiled.map(({id,version})=>({id,version})),collection_id:c.id});
  assert.equal((await json('/api/items?collection='+c.id+'&grouped=true')).items[0].group_count,3);
  for(const i of [0,1,2])await upload(i,a.id,'individual');assert.equal((await json('/api/items?collection='+a.id+'&grouped=true')).total,3,'individual reimport changes presentation without duplication');
  for(const i of [0,1,2])await upload(i);
  for(const scope of ['', '?collection='+a.id, '?collection='+b.id, '?collection='+c.id, '?collection=unfiled']){
    const stats=await json('/api/stats'+scope),cards=await json('/api/items'+scope+(scope?'&':'?')+'kind=image&grouped=true');
    assert.equal(stats.image_cards,cards.total,'Card statistics use the same library scope as grouped browsing');
  }
  let stats=await json('/api/stats?collection='+a.id);assert.equal(stats.images,3);assert.equal(stats.image_cards,1);
  await request('/api/items/'+pages[0].id,'DELETE');stats=await json('/api/stats?collection='+a.id);assert.equal(stats.images,2);assert.equal(stats.image_cards,1);
  const backup=await request('/api/export?mode=backup'),path=join(dir,'backup.zip');await writeFile(path,Buffer.from(await backup.arrayBuffer()));
  const restored=createApp({dataDir:join(dir,'restored')});try{const preview=await restored.backups.preview(path);await restored.backups.restore(preview.id);assert.deepEqual(restored.db.prepare('SELECT id,group_key,group_index,group_title,hash FROM items ORDER BY id').all(),runtime.db.prepare('SELECT id,group_key,group_index,group_title,hash FROM items ORDER BY id').all());}finally{await restored.imports.stop();await restored.backups.stop();await restored.webhooks.stop();restored.db.close()}
});
