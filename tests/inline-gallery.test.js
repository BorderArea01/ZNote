import test from 'node:test';
import assert from 'node:assert/strict';
import {openGallery,pendingInlineGalleries} from '../extensions/clipper/gallery-ticket.js';

test('inline gallery tickets preserve active jobs and scope recovery to the originating tab and frame',async t=>{
  const previous=globalThis.chrome,store={},tabs=[];
  globalThis.chrome={runtime:{getURL:p=>'chrome-extension://test/'+p},storage:{session:{
    get:async key=>structuredClone(key===null?store:{[key]:store[key]}),
    set:async values=>Object.assign(store,structuredClone(values)),
    remove:async keys=>{for(const key of keys)delete store[key]},
  }},tabs:{create:async tab=>tabs.push(tab)}};
  t.after(()=>{globalThis.chrome=previous});
  const source='https://pawchive.pw/fanbox/user/1/post/2',sender={url:source,tab:{id:3},frameId:0};
  const group={source_url:source,images:['https://file.pawchive.pw/a.png','https://file.pawchive.pw/b.png']};
  const first=await openGallery(group,sender,'save');assert.equal(first.inline,true);assert.equal(tabs.length,0);
  const key='gallery-'+first.id;store[key].busy=true;store[key].saveTarget={collection_id:'art'};store[key].saveStates=['done','active'];
  assert.equal((await openGallery(group,sender,'save')).id,first.id,'Repeated click reopens the running work');
  assert.deepEqual(await pendingInlineGalleries(sender),[{id:first.id}]);
  for(const changed of [{tab:{id:4}},{frameId:1},{url:'https://example.org/'}])assert.deepEqual(await pendingInlineGalleries({...sender,...changed}),[]);
  for(let i=0;i<14;i++)await openGallery({...group,title:String(i)},sender,'download');
  assert.equal(tabs.length,14);assert.ok(tabs.every(t=>t.url.includes('/gallery.html?id=')));
  assert.ok(store[key]?.busy,'Download tickets cannot evict an active save');assert.equal(Object.keys(store).length,10);
  store[key].saveStates=['done','duplicate'];assert.deepEqual(await pendingInlineGalleries(sender),[]);
});
