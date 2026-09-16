import test from 'node:test';
import assert from 'node:assert/strict';
import {openGallery,pendingInlineGalleries,inlineGalleryTicket} from '../addons/browser/clipper/gallery-ticket.js';

test('inline gallery tickets preserve active jobs and scope recovery to the originating tab and frame',async t=>{
  const previous=globalThis.chrome,store={},tabs=[];
  globalThis.chrome={runtime:{getURL:p=>'chrome-extension://test/'+p},storage:{local:{get:async()=>({server:'http://localhost:3741',collection_id:'art',tags:'test',token:'secret-token'})},session:{
    get:async key=>structuredClone(key===null?store:{[key]:store[key]}),
    set:async values=>Object.assign(store,structuredClone(values)),
    remove:async keys=>{for(const key of keys)delete store[key]},
  }},webNavigation:{getFrame:async()=>({url:'https://pawchive.pw/fanbox/user/1/post/2'})},tabs:{create:async tab=>tabs.push(tab)}};
  t.after(()=>{globalThis.chrome=previous});
  const source='https://pawchive.pw/fanbox/user/1/post/2',sender={url:source,tab:{id:3},frameId:0};
  const group={source_url:source,images:['https://file.pawchive.pw/a.png','https://file.pawchive.pw/b.png']};
  const first=await openGallery(group,sender,'save');assert.equal(first.inline,true);assert.equal(tabs.length,0);
  const frame={url:'chrome-extension://test/batch.html?id='+first.id,tab:{id:3},frameId:2};
  const loads=await Promise.all([inlineGalleryTicket(frame),inlineGalleryTicket(frame)]);
  assert.equal(loads.filter(r=>r.startNow).length,1,'Concurrent frame loads consume a click only once');
  assert.equal((await inlineGalleryTicket(frame)).startNow,false,'Reload never automatically retries');
  assert.deepEqual(loads[0].group.initialTarget,{server:'http://localhost:3741',collection_id:'art',tags:'test'});
  assert.ok(!JSON.stringify(loads).includes('secret-token'));
  await assert.rejects(inlineGalleryTicket({...frame,frameId:0}),/原网页|网页/);
  await assert.rejects(inlineGalleryTicket({...frame,tab:{id:4}}),/过期/);
  const key='gallery-'+first.id;store[key].busy=true;store[key].saveTarget={collection_id:'art'};store[key].saveStates=['done','active'];
  assert.equal((await openGallery(group,sender,'save')).id,first.id,'Repeated click reopens the running work');
  assert.deepEqual(await pendingInlineGalleries(sender),[{id:first.id}]);
  for(const changed of [{tab:{id:4}},{frameId:1},{url:'https://example.org/'}])assert.deepEqual(await pendingInlineGalleries({...sender,...changed}),[]);
  for(let i=0;i<14;i++)await openGallery({...group,title:String(i)},sender,'download');
  assert.equal(tabs.length,14);assert.ok(tabs.every(t=>t.url.includes('/gallery.html?id=')));
  assert.ok(store[key]?.busy,'Download tickets cannot evict an active save');assert.equal(Object.keys(store).length,10);
  store[key].saveStates=['done','duplicate'];assert.deepEqual(await pendingInlineGalleries(sender),[]);
});

test('SPA gallery tickets use the browser frame URL and reject a replaced document',async t=>{
 const previous=globalThis.chrome,store={};let url='https://pawchive.pw/fanbox/user/1/post/2',documentId='same-document';
 globalThis.chrome={runtime:{getURL:p=>'chrome-extension://test/'+p},storage:{local:{get:async()=>({})},session:{get:async key=>key===null?store:{[key]:store[key]},set:async data=>Object.assign(store,data),remove:async keys=>keys.forEach(k=>delete store[k])}},webNavigation:{getFrame:async()=>({url,documentId})},tabs:{create:async()=>{throw Error('Inline download must stay in the current page')}}};t.after(()=>globalThis.chrome=previous);
 const sender={id:'test',url:'https://pawchive.pw/fanbox/user/1/post/1',documentId,tab:{id:1},frameId:0},group={source_url:url,page_url:url,images:['https://file.pawchive.pw/a.png','https://file.pawchive.pw/b.png']};
 const result=await openGallery(group,sender,'download',true);assert.ok(result.inline);const saved=store['gallery-'+result.id];saved.started=true;saved.autoStart=false;saved.states=['done','failed'];
 assert.deepEqual(await pendingInlineGalleries(sender),[{id:result.id}]);
 await assert.rejects(openGallery({...group,page_url:sender.url},sender,'download',true),/无效/);
 documentId='replacement';await assert.rejects(openGallery(group,sender,'download',true),/页面已切换/);
});
