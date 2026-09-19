import test from 'node:test';
import assert from 'node:assert/strict';
import {copyFile,mkdtemp} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import sharp from 'sharp';
import {createApp} from '../server/app.js';
import {extractCapturePage,fetchCapturePage} from '../server/capture-page.js';
import {sharedUrls} from '../shared/share-input.js';
import {markdownImages} from '../shared/markdown-images.js';
import {captureImageCandidates} from '../server/capture-images.js';
import {platformUrl} from '../server/imports.js';
import {downloadCaptureVideo} from '../server/capture-video.js';
const xhs=(images=['https://cdn.example/one.jpg','https://cdn.example/two.jpg'])=>`<html><head><title>小红书</title></head><body><script>window.__INITIAL_STATE__=${JSON.stringify({note:{noteDetailMap:{abcd:{note:{noteId:'abcd',title:'旅行手账',desc:'第一行\n第二行',user:{nickname:'旅行作者'},imageList:images.map(urlDefault=>({urlDefault}))}}}}})};</script></body></html>`;
const xhsLive=()=>{
  const record={noteId:'6a9fb5d900000000270087c6',title:'光速开箱',desc:'三分质感好好就是真的好热喔',user:{nickname:'实况作者'},imageList:[{urlDefault:'https://sns-webpic-qc.xhscdn.com/live-cover.jpg',livePhoto:true,stream:{h264:[{width:1080,height:1440,videoBitrate:2444058,duration:2803,masterUrl:'https://sns-video-v6.xhscdn.com/live.mp4?sign=primary&t=1',backupUrls:['https://sns-bak-v1.xhscdn.com/live.mp4?sign=backup&t=1']}],h265:[{width:720,height:960,videoBitrate:1200000,masterUrl:'https://sns-video-v6.xhscdn.com/live-low.mp4?sign=low'}]}}]};
  return '<script>window.__INITIAL_STATE__='+JSON.stringify({note:{noteDetailMap:{[record.noteId]:{note:record}}}})+'</script>';
};
const douyinLive=()=>{
  const picture=name=>({origin_url:`https://p3.douyinpic.com/${name}.jpg`,url_list:[`https://p9.douyinpic.com/${name}.jpg`]});
  const images=[{...picture('live'),live_photo_type:1,video:{play_addr:{url_list:['https://v26.douyinvod.com/live.mp4']}}},picture('still')];
  return '<script>window._ROUTER_DATA = '+JSON.stringify({aweme_details:[{aweme_id:'7685',aweme_type:68,desc:'实况作品',author:{nickname:'实况作者'},image_list:images}]})+'</script>';
};
const douyinCurrentLive=()=>{
  const record={awemeId:'7686',awemeType:68,desc:'实况单图',authorInfo:{nickname:'动态作者'},images:[{urlList:['https://p3.douyinpic.com/cover.jpeg'],clipType:5,livePhotoType:1,video:{duration:2200,dataSize:320603,playAddr:[{src:'https://v26-web.douyinvod.com/live.mp4?token=test'}]}}]};
  const payload='7:'+JSON.stringify(['$',null,null,{awemeId:'7686',aweme:{detail:record}}]);
  return '<script>self.__pace_f.push('+JSON.stringify([1,payload])+')</script>';
};
test('mobile platform variants retain work identity, author and native playback data',async()=>{
  assert.equal(new URL(platformUrl('https://m.bilibili.com/video/BV1Mi4d6gENF?p=2')).host,'www.bilibili.com');
  assert.equal(new URL(platformUrl('https://m.bilibili.com/video/BV1Mi4d6gENF?p=2')).searchParams.get('p'),'2');
  const record={noteId:'abcd',type:'video',title:'作品',user:{nickName:'作者'},video:{media:{stream:{h264:[{width:720,height:1280,masterUrl:'https://cdn.example/video.mp4',backupUrls:['https://backup.example/video.mp4']}]}}}};
  const html='<script>window.__SETUP_SERVER_STATE__='+JSON.stringify({LAUNCHER_SSR_STORE_PAGE_DATA:{noteData:record}})+';</script>';
  const plan=extractCapturePage(html,'https://www.xiaohongshu.com/discovery/item/abcd');assert.equal(plan.kind,'video');assert.equal(plan.author,'作者');assert.equal(plan.video_urls.length,2);
  assert.throws(()=>extractCapturePage(html,'https://www.xiaohongshu.com/discovery/item/ffff'),/完整数据/);
  const dir=await mkdtemp(resolve('artifacts/capture-video-'));
  await assert.rejects(downloadCaptureVideo({plan:{...plan,video_urls:['http://127.0.0.1/private']},dir,signal:AbortSignal.timeout(1000),progress:()=>{}}),/内网/);
});
test('platform images prefer original variants without altering unrelated signatures or artwork marks',()=>{
  const display='https://sns-webpic-qc.xhscdn.com/20260915/signature/1040g2sg0token!nd_dft_wlteh_webp_3?sign=keep';
  assert.deepEqual(captureImageCandidates({urlDefault:display},'xhs','https://www.xiaohongshu.com/explore/abcd'),['https://sns-img-bd.xhscdn.com/1040g2sg0token',display]);
  const signed='https://cdn.example/image.jpg?sign=keep&watermark=author';
  assert.deepEqual(captureImageCandidates({urlDefault:signed},'xhs','https://example.com'),[signed]);
  assert.deepEqual(captureImageCandidates({url_list:['https://cdn.example/display'],origin_url:'https://cdn.example/original',download_url_list:['https://cdn.example/watermark']},'douyin','https://www.douyin.com'),['https://cdn.example/original','https://cdn.example/display','https://cdn.example/watermark']);
  assert.deepEqual(captureImageCandidates({urlList:['https://cdn.example/camel-display'],downloadUrlList:['https://cdn.example/camel-watermark']},'douyin','https://www.douyin.com'),['https://cdn.example/camel-display','https://cdn.example/camel-watermark']);
  const plan=extractCapturePage(xhs([display]),'https://www.xiaohongshu.com/explore/abcd');assert.equal(plan.images[0],plan.image_candidates[0][0]);assert.equal(plan.image_candidates[0].length,2);
});
test('share parsing and article extraction preserve links, line breaks and exact platform work',()=>{
  assert.deepEqual(sharedUrls('分享给你 https://xhslink.com/a/abcd。'),['https://xhslink.com/a/abcd']);
  const note=extractCapturePage(xhs(),'https://www.xiaohongshu.com/explore/abcd');assert.equal(note.author,'旅行作者');assert.equal(note.images.length,2);assert.match(note.content,/第一行\n第二行/);
  assert.throws(()=>extractCapturePage(xhs(),'https://www.xiaohongshu.com/explore/ffff'),/完整数据/);
  const article=extractCapturePage('<html><head><title>文章</title></head><body><article><h1>文章</h1><p>第一行<br>第二行 <a href="/reference">参考链接</a></p><img data-src="/one.png"><p>'+('这是一段用于确认正文提取的文字。'.repeat(30))+'</p></article></body></html>','https://example.com/article');
  assert.match(article.content,/https:\/\/example.com\/reference/);assert.equal(markdownImages(article.content)[0].url,'https://example.com/one.png');assert.match(article.content,/第一行[\s\S]*\n第二行/);
  const video=extractCapturePage('<script id="RENDER_DATA">'+encodeURIComponent(JSON.stringify({aweme:{aweme_id:'123',author:{nickname:'作者'},desc:'视频',video:{}}}))+'</script>','https://www.douyin.com/video/123');assert.equal(video.kind,'video');
});
test('Paw mobile capture keeps the original work files and body',()=>{
  const html='<main><h1>Paw 作品</h1><div class="post__content"><p>正文说明</p></div><figure><a href="https://file.pawchive.pw/data/a.png?f=a.png"><img src="https://img.pawchive.pw/thumb/a.png"></a></figure><a class="fileThumb" href="https://file.pawchive.st/data/b.jpg?f=b.jpg"><img src="https://img.pawchive.st/thumb/b.jpg"></a></main>';
  const plan=extractCapturePage(html,'https://pawchive.pw/fanbox/user/demo/post/work');
  assert.equal(plan.kind,'note');assert.equal(plan.title,'Paw 作品');assert.match(plan.content,/正文说明/);assert.deepEqual(plan.images,['https://file.pawchive.pw/data/a.png?f=a.png','https://file.pawchive.st/data/b.jpg?f=b.jpg']);
});
test('Douyin slides preserve static covers and live-photo playback candidates',()=>{
  const image=(name,live=false)=>({origin_url:`https://p3.douyinpic.com/${name}.jpg`,url_list:[`https://p9.douyinpic.com/${name}.jpg`],...(live?{live_photo_type:1,video:{play_addr:{url_list:[`https://v26.douyinvod.com/${name}.mp4`]},download_addr:{url_list:[`https://watermark.example/${name}.mp4`]}}}:{})});
  const record={aweme_id:'7685',aweme_type:68,desc:'第一行\n第二行',author:{nickname:'实况作者'},image_list:[image('one',true),image('two')]};
  const plan=extractCapturePage('<script>window._ROUTER_DATA = '+JSON.stringify({aweme_details:[record]})+'</script>','https://www.iesdouyin.com/share/slides/7685/');
  assert.equal(plan.kind,'note');assert.equal(plan.images.length,2);assert.equal(plan.author,'实况作者');
  assert.deepEqual(plan.live_videos,[{index:0,urls:['https://v26.douyinvod.com/one.mp4','https://watermark.example/one.mp4']}]);
});
test('Douyin React Flight detail extracts the complete image post',()=>{
  const record={awemeId:'7685',desc:'图文正文',authorInfo:{nickname:'新结构作者'},images:[{urlList:['https://p3.douyinpic.com/one.webp'],downloadUrlList:['https://p3.douyinpic.com/one-watermarked.webp'],video:{playAddr:{urlList:['https://v26.douyinvod.com/one.mp4']}}},{urlList:['https://p3.douyinpic.com/two.webp']}]};
  const payload='7:'+JSON.stringify(['$',null,null,{awemeId:'7685',aweme:{detail:record}}]);
  const html='<script>self.__pace_f.push('+JSON.stringify([1,payload])+')</script>';
  const plan=extractCapturePage(html,'https://www.douyin.com/note/7685');
  assert.equal(plan.title,'图文正文');assert.equal(plan.author,'新结构作者');assert.equal(plan.images.length,2);
  assert.deepEqual(plan.live_videos,[{index:0,urls:['https://v26.douyinvod.com/one.mp4']}]);
});
test('Douyin live photos in current image posts extract playAddr src mirrors instead of saving only the cover',()=>{
  const record={awemeId:'7686',awemeType:68,desc:'找到你了#影 #cos',authorInfo:{nickname:'冷色调'},images:[{urlList:['https://p3.douyinpic.com/cover.jpeg'],clipType:5,livePhotoType:1,video:{duration:2200,dataSize:320603,playAddr:[{src:'https://v11-weba.douyinvod.com/live.mp4?token=one'},{src:'https://v26-web.douyinvod.com/live.mp4?token=two'}],cover:'https://p3.douyinpic.com/video-cover.jpeg'}}]};
  const payload='7:'+JSON.stringify(['$',null,null,{awemeId:'7686',aweme:{detail:record}}]);
  const html='<script>self.__pace_f.push('+JSON.stringify([1,payload])+')</script>';
  const plan=extractCapturePage(html,'https://www.douyin.com/note/7686');
  assert.equal(plan.kind,'note');assert.equal(plan.images.length,1);assert.equal(plan.author,'冷色调');
  assert.deepEqual(plan.live_videos,[{index:0,urls:['https://v11-weba.douyinvod.com/live.mp4?token=one','https://v26-web.douyinvod.com/live.mp4?token=two']}]);
});
test('Xiaohongshu live-photo image streams are captured as playable videos, not still covers',()=>{
  const url='https://www.xiaohongshu.com/explore/6a9fb5d900000000270087c6';
  const plan=extractCapturePage(xhsLive(),url);
  assert.equal(plan.kind,'note');assert.equal(plan.title,'光速开箱');assert.equal(plan.author,'实况作者');
  assert.equal(plan.images.length,1);
  assert.deepEqual(plan.live_videos,[{index:0,urls:['https://sns-video-v6.xhscdn.com/live.mp4?sign=primary&t=1','https://sns-bak-v1.xhscdn.com/live.mp4?sign=backup&t=1','https://sns-video-v6.xhscdn.com/live-low.mp4?sign=low']}]);
});
test('remote capture rejects local addresses and unsafe schemes before fetching',async()=>{
  for(const url of ['http://127.0.0.1/x','http://192.168.1.1','http://[::1]/','file:///etc/passwd','http://user:pass@example.com/'])await assert.rejects(fetchCapturePage(url,new AbortController().signal));
});
test('capture archives image groups locally, retries without duplication, persists jobs and enriches WeChat',async t=>{
  const dir=await mkdtemp(resolve('artifacts/captures-'));let calls=0,failImage=true,incoming=[];
  const png=await sharp({create:{width:24,height:24,channels:3,background:'#6789ab'}}).png().toBuffer();
  const runtime=createApp({dataDir:dir,captureOptions:{
    page:async url=>url.includes('/7686')?{url:'https://www.douyin.com/note/7686',type:'text/html',buffer:Buffer.from(douyinCurrentLive())}:url.includes('douyin.com')?{url:'https://www.iesdouyin.com/share/slides/7685/',type:'text/html',buffer:Buffer.from(douyinLive())}:url.includes('6a9fb5d900000000270087c6')?{url:'https://www.xiaohongshu.com/explore/6a9fb5d900000000270087c6',type:'text/html',buffer:Buffer.from(xhsLive())}:{url:'https://www.xiaohongshu.com/explore/abcd',type:'text/html',buffer:Buffer.from(xhs())},
    image:async()=>{calls++;if(failImage&&calls===2)throw Error('network');return png;},
    captureVideo:async({plan,dir:target})=>{const path=join(target,'live.mp4');await copyFile(resolve('tests/fixtures/sample.mp4'),path);return {path,originalname:'live.mp4',title:plan.title,author:plan.author,description:plan.description||''};}
  },weixinClient:{updates:async()=>({msgs:incoming.splice(0),get_updates_buf:'next'})}});
  const server=runtime.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  t.after(async()=>{await runtime.weixin.stop();await runtime.captures.stop();await runtime.imports.stop();await runtime.trash.stop();await runtime.backups.stop();await runtime.webhooks.stop();await new Promise(r=>server.close(r));runtime.db.close();});
  const base='http://127.0.0.1:'+server.address().port,setup=await fetch(base+'/api/auth/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'1234'})}),cookie=setup.headers.get('set-cookie').split(';')[0];
  const request=(path,method='GET',body)=>fetch(base+path,{method,headers:{Cookie:cookie,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
  const json=async(...args)=>{const r=await request(...args);assert.ok(r.ok,await r.clone().text());return r.json();};
  const library=await json('/api/collections','POST',{name:'手机收集'}),other=await json('/api/collections','POST',{name:'其他'}),xhsLibrary=await json('/api/collections','POST',{name:'小红书实况'});
  const input={text:'好看的作品 https://xhslink.com/a/abcd',collection_id:library.id,request_id:'mobile-test'};
  const job=await json('/api/captures','POST',input);assert.equal((await json('/api/captures','POST',input)).id,job.id);
  await assert.rejects(runtime.captures.wait(job.id,AbortSignal.timeout(5000)),/失败/);assert.equal(runtime.db.prepare("SELECT count(*) n FROM items WHERE kind='image'").get().n,1);
  failImage=false;await json('/api/captures/'+job.id+'/retry','POST',{});const done=await runtime.captures.wait(job.id,AbortSignal.timeout(5000));
  const note=await json('/api/items/'+done.item_id);assert.equal(note.collection_id,library.id);assert.ok(note.tags.includes('旅行作者'));assert.ok(note.tags.includes('小红书'));assert.equal(markdownImages(note.content).length,0);assert.equal(markdownImages(note.content,true).length,2);
  assert.equal(runtime.db.prepare("SELECT count(*) n FROM items WHERE group_key=?").get('note:'+note.id).n,2);assert.equal(calls,3);
  assert.equal((await request('/api/captures','POST',{...input,collection_id:other.id})).status,409);
  assert.equal((await fetch(base+'/api/captures')).status,401);
  const live=await json('/api/captures','POST',{text:'https://www.douyin.com/note/7685',collection_id:library.id,image_mode:'group',request_id:'douyin-live'});
  const liveDone=await runtime.captures.wait(live.id,AbortSignal.timeout(10000));assert.match(liveDone.message,/1 段实况视频/);
  const liveItems=runtime.db.prepare("SELECT kind,group_key,group_index,tags,source_url FROM items WHERE source_url=? ORDER BY group_index").all('https://www.iesdouyin.com/share/slides/7685/');
  assert.deepEqual(liveItems.map(v=>v.kind),['video','image']);assert.equal(new Set(liveItems.map(v=>v.group_key)).size,1);assert.deepEqual(liveItems.map(v=>v.group_index),[0,1]);assert.ok(JSON.parse(liveItems[0].tags).includes('实况作者'));
  const motion=await json('/api/captures','POST',{text:'https://www.douyin.com/note/7686',collection_id:other.id,request_id:'douyin-live-only'});
  const motionDone=await runtime.captures.wait(motion.id,AbortSignal.timeout(10000));assert.match(motionDone.message,/1 段实况视频/);
  const motionItems=runtime.db.prepare("SELECT kind,tags FROM items WHERE source_url=?").all('https://www.douyin.com/note/7686');
  assert.deepEqual(motionItems.map(v=>v.kind),['video']);assert.ok(JSON.parse(motionItems[0].tags).includes('动态作者'));
  const xhsMotion=await json('/api/captures','POST',{text:'https://www.xiaohongshu.com/explore/6a9fb5d900000000270087c6',collection_id:xhsLibrary.id,request_id:'xhs-live-photo'});
  const xhsMotionDone=await runtime.captures.wait(xhsMotion.id,AbortSignal.timeout(10000));assert.match(xhsMotionDone.message,/1 段实况视频/);
  const xhsMotionItems=runtime.db.prepare("SELECT kind,tags,group_key FROM items WHERE source_url=?").all('https://www.xiaohongshu.com/explore/6a9fb5d900000000270087c6');
  assert.deepEqual(xhsMotionItems.map(v=>v.kind),['video']);assert.ok(JSON.parse(xhsMotionItems[0].tags).includes('实况作者'));
  // No auto-capture for old messages/settings. New opt-in messages get a durable target.
  runtime.db.prepare("INSERT INTO settings VALUES('weixin_inbox_v1',?)").run(JSON.stringify({enabled:true,capture_links:true,collection_id:library.id,tags:['微信'],merge_mode:'daily',account:{token:'test',bot:'bot',user:'owner'},cursor:'',jobs:[]}));
  incoming.push({message_type:1,message_state:2,message_id:'1',from_user_id:'owner',create_time_ms:Date.now(),item_list:[{type:1,text_item:{text:'灵感\n第二行\nhttps://xhslink.com/a/abcd'}}]});
  await runtime.weixin.tick(new AbortController().signal);await runtime.weixin.tick(new AbortController().signal);
  const state=runtime.weixin.status();assert.equal(state.jobs[0].state,'done');const daily=await json('/api/items/'+state.jobs[0].items[0]);assert.match(daily.content,/灵感\n第二行/);assert.match(daily.content,/已归档/);
  assert.equal(JSON.parse(runtime.db.prepare("SELECT value FROM settings WHERE key='mobile_captures_v1'").get().value).length,5);
});
