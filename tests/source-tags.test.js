import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../server/app.js';
import {withSource} from '../server/source.js';
import {MAX_ITEM_TAGS} from '../shared/tag-limits.js';
test('large source tag sets remain editable, searchable and additive; excessive tags fail atomically',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'znote-tags-')),runtime=createApp({dataDir:dir});
 const server=runtime.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 let cookie;const api=async(path,body,method='POST')=>fetch(`http://127.0.0.1:${server.address().port}${path}`,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});
 try{
  const setup=await api('/api/auth/setup',{password:'tag-fixture'});assert.equal(setup.status,201);cookie=setup.headers.get('set-cookie').split(';')[0];
  const tags=Array.from({length:148},(_,i)=>'标签'+i);
  const created=await api('/api/items',{title:'source fixture',tags});assert.equal(created.status,201);let item=await created.json();
  const updated=await api('/api/items/'+item.id,{version:item.version,title:'editable'},'PATCH');assert.equal(updated.status,200);item=await updated.json();assert.deepEqual(item.tags,tags);
  const added=await api('/api/items/batch-tags',{items:[{id:item.id,version:item.version}],tags:['原有标签'],mode:'add'});assert.equal(added.status,200);item=(await added.json()).items[0];assert.equal(item.tags.length,149);
  const excessive=await api('/api/items/batch-tags',{items:[{id:item.id,version:item.version}],tags:Array.from({length:MAX_ITEM_TAGS},(_,i)=>'new'+i),mode:'add'});assert.equal(excessive.status,400);
  const saved=await(await api('/api/items/'+item.id,null,'GET')).json();assert.deepEqual(saved.tags,item.tags);assert.equal(saved.version,item.version);
  const filtered=await(await api('/api/items?tag='+encodeURIComponent(tags.at(-1)),null,'GET')).json();assert.ok(filtered.items.some(i=>i.id===item.id));
  assert.equal(withSource({source_url:'https://www.pixiv.net/artworks/1',tags}).tags.length,149);
  assert.throws(()=>withSource({source_url:'https://www.pixiv.net/artworks/1',tags:Array.from({length:MAX_ITEM_TAGS},(_,i)=>'t'+i)}),/标签/);
 }finally{await new Promise(r=>server.close(r));runtime.db.close();await rm(dir,{recursive:true,force:true});}
});
