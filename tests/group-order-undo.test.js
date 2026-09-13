import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import sharp from 'sharp';
import {createApp} from '../server/app.js';

test('sort undo restores complete group order and note syntax without overwriting later changes',async t=>{
  const dir=await mkdtemp(resolve('artifacts/order-undo-'));
  let runtime,server,base,cookie;
  const start=async()=>{runtime=createApp({dataDir:dir});server=runtime.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base='http://127.0.0.1:'+server.address().port;};
  const stop=async()=>{await runtime.trash.stop();await runtime.imports.stop();await runtime.backups.stop();await runtime.webhooks.stop();await new Promise(r=>server.close(r));runtime.db.close();};
  await start();t.after(stop);
  const request=(path,method='GET',body)=>fetch(base+path,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
  const json=async(...args)=>{const r=await request(...args);assert.ok(r.ok,await r.clone().text());return r.json();};
  const setup=await request('/api/auth/setup','POST',{password:'0921'});cookie=setup.headers.get('set-cookie').split(';')[0];
  const library=await json('/api/collections','POST',{name:'排序撤销'}),other=await json('/api/collections','POST',{name:'另一个库'});
  const bytes=await sharp({create:{width:24,height:32,channels:3,background:'#6c85a6'}}).png().toBuffer();
  let group=0;
  const upload=async(key,index)=>{const form=new FormData();for(const [k,v]of Object.entries({file:new Blob([bytes],{type:'image/png'}),title:'第 '+index+' 页',collection_id:library.id,source_url:'https://example.com/art/'+key,group_key:key,group_title:'画册 '+key,group_index:String(index)}))form.append(k,v);const r=await fetch(base+'/api/assets',{method:'POST',headers:{Cookie:cookie},body:form});assert.ok(r.ok,await r.clone().text());return r.json();};
  const make=async()=>{const key='order:'+ ++group;return Promise.all([0,1,2,3].map(i=>upload(key,i)));};
  const state=id=>json('/api/item-groups/order?id='+id);
  const order=async(id,ids,extra={})=>{const snapshot=await state(id);return json('/api/item-groups/order','POST',{id,ids,revision:snapshot.revision,undo:true,...extra});};
  const undo=id=>json('/api/undo/'+id,'POST',{});
  const get=id=>json('/api/items/'+id);
  const rows=()=>runtime.db.prepare('SELECT * FROM items ORDER BY id').all();
  await t.test('legacy opt-out, no-op, unrelated metadata, source identity, replay, restart and original bytes',async()=>{
    const pages=await make(),ids=pages.map(p=>p.id),reverse=ids.toReversed();
    assert.equal((await order(ids[0],ids)).undo,null);
    assert.equal((await order(ids[0],reverse,{undo:false})).undo,null);
    const changed=await order(ids[0],ids);assert.ok(changed.undo?.id);
    const item=await get(ids[0]);await json('/api/items/'+item.id,'PATCH',{version:item.version,favorite:true,tags:['保留新标签']});
    await stop();await start();assert.ok((await json('/api/undo')).actions.some(a=>a.id===changed.undo.id));
    await undo(changed.undo.id);assert.deepEqual((await state(ids[0])).items.map(i=>i.id),reverse);assert.equal((await state(ids[0])).cover_id,reverse[0]);
    const retained=await get(ids[0]);assert.equal(retained.favorite,true);assert.deepEqual(retained.tags,['保留新标签']);
    assert.deepEqual(await Promise.all(ids.map(async id=>(await get(id)).group_index)),[0,1,2,3]);
    assert.ok(Buffer.from(await (await request(pages[0].url)).arrayBuffer()).equals(bytes));
    const before=rows();assert.equal((await undo(changed.undo.id)).already_undone,true);assert.deepEqual(rows(),before);
  });
  await t.test('full note syntax restores together with attachment order; title edits survive',async()=>{
    const pages=await make();const note=await json('/api/items','POST',{title:'原笔记',collection_id:library.id,content:`# 观察\n\n[![第一张](${pages[0].url} "标题")](https://example.com/source)\n\n正文 [链接](https://example.com)\n\n![第二张](${pages[1].url})\n\n结尾`});
    const original=await state(note.id),changed=await order(note.id,original.items.map(i=>i.id).reverse());
    assert.ok(changed.undo.count>=3);const current=await get(note.id);await json('/api/items/'+note.id,'PATCH',{version:current.version,title:'新标题'});
    await undo(changed.undo.id);assert.equal((await get(note.id)).content,note.content);assert.equal((await get(note.id)).title,'新标题');assert.deepEqual((await state(note.id)).items.map(i=>i.id),original.items.map(i=>i.id));
    const onlyOrder=await order(note.id,original.items.map(i=>i.id).reverse(),{sync_note:false});assert.equal((await get(note.id)).content,note.content);await undo(onlyOrder.undo.id);assert.equal((await get(note.id)).content,note.content);
    const again=await order(note.id,original.items.map(i=>i.id).reverse());const edited=await get(note.id);await json('/api/items/'+note.id,'PATCH',{version:edited.version,content:edited.content+'\n新正文'});
    const before=rows();assert.equal((await request('/api/undo/'+again.undo.id,'POST',{})).status,409);assert.deepEqual(rows(),before);
  });
  await t.test('stationary members also guard against newer sorting, and LIFO undo still works',async()=>{
    const pages=await make(),ids=pages.map(p=>p.id);
    await order(ids[0],ids.toReversed(),{undo:false});await order(ids[0],ids,{undo:false}); // explicit display order
    const first=await order(ids[0],[ids[1],ids[0],ids[2],ids[3]]);
    const second=await order(ids[0],[ids[1],ids[0],ids[3],ids[2]]);
    const before=rows();assert.equal((await request('/api/undo/'+first.undo.id,'POST',{})).status,409);assert.deepEqual(rows(),before);
    await undo(second.undo.id);await undo(first.undo.id);assert.deepEqual((await state(ids[0])).items.map(i=>i.id),ids);
  });
  await t.test('added, deleted, regrouped and moved members reject the entire undo',async()=>{
    for(const mode of ['append','delete','regroup','move']){
      const pages=await make(),ids=pages.map(p=>p.id),changed=await order(ids[0],ids.toReversed());
      const item=await get(ids[2]);
      if(mode==='append')await upload(pages[0].group_key,4);
      if(mode==='delete')await json('/api/items/batch-trash','POST',{items:[{id:item.id,version:item.version}],collection_id:library.id});
      if(mode==='regroup'){
        const plan=await json('/api/item-groups/organize/preview','POST',{items:[{id:item.id,version:item.version}],collection_id:library.id,mode:'detach'});
        await json('/api/item-groups/organize','POST',{...plan.input,revision:plan.revision,operation_id:plan.operation_id,prepared_at:plan.prepared_at});
      }
      if(mode==='move')await json('/api/item-groups/move','POST',{id:ids[0],version:(await get(ids[0])).version,collection_id:other.id,move_note:true});
      const before=rows();assert.equal((await request('/api/undo/'+changed.undo.id,'POST',{})).status,409,mode);assert.deepEqual(rows(),before);
    }
  });
  await t.test('backup restores order but invalidates undo receipts',async()=>{
    const pages=await make(),ids=pages.map(p=>p.id),changed=await order(ids[0],ids.toReversed());
    const archive=join(dir,'order-backup.zip');await writeFile(archive,Buffer.from(await (await request('/api/export?mode=backup')).arrayBuffer()));
    const isolated=createApp({dataDir:join(dir,'restored')});
    try{const preview=await isolated.backups.preview(archive);await isolated.backups.restore(preview.id);assert.equal(isolated.db.prepare('SELECT count(*) n FROM undo_actions').get().n,0);assert.equal(isolated.db.prepare('SELECT group_order FROM items WHERE id=?').get(ids[3]).group_order,0);assert.ok(changed.undo);}finally{await isolated.trash.stop();await isolated.imports.stop();await isolated.backups.stop();await isolated.webhooks.stop();isolated.db.close();}
  });
});
