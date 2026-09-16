import test from 'node:test';
import assert from 'node:assert/strict';
import '../addons/browser/clipper/video-groups.js';
import {addResource} from '../addons/browser/clipper/resource-store.js';
test('video cards group only confirmed work identities and keep alternate media available',()=>{
 const state={source_url:'https://www.douyin.com/user/self',resources:[]};
 const first=addResource(state,{url:'https://www.douyin.com/aweme/v1/play/?video_id=one',kind:'video',work_id:'123',author:'作者甲',poster:'https://img.test/cover.jpg',source_url:'https://www.douyin.com/video/123',metadata_rank:3});
 addResource(state,{url:'https://v26-web.douyinvod.com/movie.mp4',work_id:'123',author:'作者甲',source_url:first.source_url,metadata_rank:3});
 addResource(state,{url:'https://cdn.test/different.mp4',work_id:'456',title:'同名标题',source_url:'https://www.douyin.com/video/456',metadata_rank:3});
 addResource(state,{url:'https://cdn.test/unidentified.mp4',title:'同名标题'});
 const groups=ZNoteVideoGroups(state.resources);assert.equal(groups.length,3);assert.equal(groups[0].items.length,2);assert.ok(groups[0].primary.url.includes('douyinvod.com'));
 addResource(state,{url:first.url,kind:'video',poster:'javascript:alert(1)',author:'导航作者',work_id:'999',metadata_rank:1});assert.equal(first.poster,'https://img.test/cover.jpg');assert.equal(first.author,'作者甲');assert.equal(first.work_id,'123');
 const invalid=addResource(state,{url:'https://cdn.test/invalid.mp4',poster:'data:text/html,unsafe',work_id:'<x>'});assert.equal(invalid.poster,'');assert.equal(invalid.work_id,'');
});
