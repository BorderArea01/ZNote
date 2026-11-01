import test from 'node:test';
import assert from 'node:assert/strict';
import {createInlinePreview,inlinePreviewMessage} from '../addons/browser/clipper/inline-preview-ticket.js';
test('inline preview tickets bind the frame to its original tab and page, exclude credentials, expire and release',async()=>{
  const previous=globalThis.chrome,cache={},local={};let page='https://example.test/post';
  globalThis.chrome={runtime:{getURL:path=>'chrome-extension://fixture/'+path},tabs:{get:async()=>({url:page})},storage:{session:{
    get:async key=>key==null?structuredClone(cache):{[key]:structuredClone(cache[key])},set:async values=>Object.assign(cache,structuredClone(values)),remove:async keys=>{for(const key of Array.isArray(keys)?keys:[keys])delete cache[key];}},local:{get:async()=>local}}};
  try{
    const value=await createInlinePreview({kind:'video',url:'https://cdn.test/file.mp4',source_url:page,server_token:'must never reach frame'},1);
    const sender={tab:{id:1},frameId:2,url:'chrome-extension://fixture/inline-preview.html?id='+value.preview_id};
    const input={type:'inline-preview-load',id:value.preview_id};
    const loaded=await inlinePreviewMessage(input,sender);assert.equal(loaded.resource.server_token,undefined);assert.equal(loaded.parent_origin,'https://example.test');
    await assert.rejects(()=>inlinePreviewMessage(input,{...sender,tab:{id:2}}),/过期/);
    await assert.rejects(()=>inlinePreviewMessage(input,{...sender,url:page}),/来源/);
    page='https://example.test/another';await assert.rejects(()=>inlinePreviewMessage(input,sender),/切换/);page='https://example.test/post';
    local.blockedSites=['example.test'];await assert.rejects(()=>inlinePreviewMessage(input,sender),/停用/);local.blockedSites=[];
    const key='inlinePreview:'+value.preview_id,created=cache[key].created;cache[key].created=Date.now()-600001;await assert.rejects(()=>inlinePreviewMessage(input,sender),/过期/);cache[key].created=created;
    await assert.rejects(()=>inlinePreviewMessage({type:'inline-preview-release',id:value.preview_id},sender),/当前页面/);
    await inlinePreviewMessage({type:'inline-preview-release',id:value.preview_id},{tab:{id:1},frameId:0});assert.equal(Object.keys(cache).length,0);
  }finally{globalThis.chrome=previous;}
});
