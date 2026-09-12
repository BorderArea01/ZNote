import test from 'node:test';import assert from 'node:assert/strict';import '../extensions/clipper/preview-cache.js';
test('preview cache coalesces requests and releases pages outside the retained window',async()=>{
 let calls=0,aborted=0;const disposed=[];
 const cache=new globalThis.ZNotePreviewCache((url,signal)=>{calls++;signal.addEventListener('abort',()=>aborted++);return Promise.resolve(url);},value=>disposed.push(value));
 const first=cache.get('one');assert.equal(cache.get('one'),first);await first;await cache.get('two');await cache.get('three');assert.equal(calls,3);
 cache.retain(['two','three','four']);assert.deepEqual(disposed,['one']);await cache.get('four');assert.equal(cache.entries.size,3);cache.clear();assert.equal(cache.entries.size,0);assert.equal(aborted,4);
});
