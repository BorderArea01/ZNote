import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,readdir,writeFile,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {youtubeVideoUrl} from '../shared/youtube.js';
import {platformUrl,mediaTools,runMediaCommand} from '../server/imports.js';
import {extractCapturePage} from '../server/capture-page.js';
import {youtubeResource,validateYoutubeResource} from '../addons/browser/clipper/youtube-formats.js';
import {readYoutubeTrack,youtubeTrackSize} from '../addons/browser/clipper/youtube-download.js';
import {createApp} from '../server/app.js';
import {observeYoutubePlayback,youtubePlaybackRequest} from '../addons/browser/clipper/youtube-session.js';
const source='https://www.youtube.com/watch?v=TuR6De4SI5c';
const stream=(itag,mime,extra={})=>({itag,mimeType:mime,contentLength:'1000',url:`https://r1.googlevideo.com/videoplayback?id=work1&itag=${itag}&clen=1000&range=0-1`,...extra});
const player=()=>({playabilityStatus:{status:'OK'},videoDetails:{videoId:'TuR6De4SI5c',title:'标题',author:'作者'},streamingData:{adaptiveFormats:[stream(137,'video/mp4; codecs="avc1.640028"',{height:1080}),stream(140,'audio/mp4; codecs="mp4a.40.2"')]}});
test('YouTube URLs are strict, canonical single-video links and never text-only notes',()=>{
  for(const url of [source,'https://youtu.be/TuR6De4SI5c?t=1','https://m.youtube.com/shorts/TuR6De4SI5c','https://www.youtube.com/watch?v=TuR6De4SI5c&list=foo']){
    assert.equal(platformUrl(url),source);assert.equal(extractCapturePage('<p>not a note</p>',url).kind,'video');
  }
  for(const url of ['https://youtube.com.evil.test/watch?v=TuR6De4SI5c','https://secret@youtube.com/watch?v=TuR6De4SI5c','https://youtube.com/playlist?list=foo','https://youtu.be/TuR6De4SI5c/other','http://127.0.0.1/watch?v=TuR6De4SI5c']){
    assert.equal(youtubeVideoUrl(url),'');assert.throws(()=>platformUrl(url));
  }
});
test('authorized player selects both tracks from the same work, rejects gated/other/ad/live/DRM data',()=>{
  const p=player(),r=youtubeResource(p,{pageUrl:source});
  assert.equal(r.tracks.length,2);assert.equal(r.tracks[0].height,1080);validateYoutubeResource(r,source);
  const other=player();other.videoDetails.videoId='abcdefghijk';assert.throws(()=>youtubeResource(other,{pageUrl:source}));
  const gated=player();gated.playabilityStatus.status='LOGIN_REQUIRED';assert.throws(()=>youtubeResource(gated,{pageUrl:source}),/登录/);
  const live=player();live.videoDetails.isLiveContent=true;assert.throws(()=>youtubeResource(live,{pageUrl:source}),/直播/);
  const mismatch=player();mismatch.streamingData.adaptiveFormats[1].url=mismatch.streamingData.adaptiveFormats[1].url.replace('work1','other');assert.throws(()=>youtubeResource(mismatch,{pageUrl:source}),/完整/);
  const drm=player();drm.streamingData.adaptiveFormats[0].drmFamilies=['WIDEVINE'];assert.throws(()=>youtubeResource(drm,{pageUrl:source}),/完整/);
  const cipher=player();const f=cipher.streamingData.adaptiveFormats[0];f.signatureCipher=new URLSearchParams({url:f.url,s:'cipher'}).toString();delete f.url;
  assert.throws(()=>youtubeResource(cipher,{pageUrl:source}),/完整/);
  const observed=['https://r2.googlevideo.com/videoplayback?id=other&itag=137&clen=1000','https://r2.googlevideo.com/videoplayback?id=work1&itag=137&clen=1000&sig=authorized'];
  assert.match(youtubeResource(cipher,{pageUrl:source,observed}).tracks[0].url,/sig=authorized/);
  assert.throws(()=>validateYoutubeResource({...r,tracks:[r.tracks[0]]},source));
});
test('YouTube buffered query range is replaced, exact length required and HTTP failures never save',async()=>{
  const bytes=Buffer.alloc(9*1024*1024,19);let calls=0;
  const track={url:'https://r1.googlevideo.com/videoplayback?id=work&itag=137&range=0-10',size:bytes.length,mime:'video/mp4'};
  const blob=await readYoutubeTrack(track,{fetcher:async url=>{calls++;const [a,b]=new URL(url).searchParams.get('range').split('-').map(Number);return new Response(bytes.subarray(a,b+1));}});
  assert.equal(calls,2);assert.deepEqual(Buffer.from(await blob.arrayBuffer()),bytes);
  await assert.rejects(()=>readYoutubeTrack(track,{fetcher:async()=>new Response('expired',{status:403})}),/授权/);
  await assert.rejects(()=>readYoutubeTrack(track,{fetcher:async()=>new Response('short')}),/不完整/);
  await assert.rejects(()=>readYoutubeTrack({...track,url:'http://127.0.0.1/file'}),/地址/);
});
test('observed progressive playback without a metadata length is probed before complete download',async()=>{
  const p=player(),f=stream(18,'video/mp4; codecs="avc1.42001E, mp4a.40.2"',{audioQuality:'AUDIO_QUALITY_MEDIUM'});
  delete f.contentLength;f.signatureCipher=new URLSearchParams({url:f.url.replace('&clen=1000',''),s:'cipher'}).toString();delete f.url;
  p.streamingData={formats:[f],adaptiveFormats:[]};const observed=['https://r1.googlevideo.com/videoplayback?id=work1&itag=18&sig=authorized&range=2-3'];
  const r=youtubeResource(p,{pageUrl:source,observed});assert.equal(r.tracks[0].size,0);assert.equal(r.tracks[0].muxed,true);validateYoutubeResource(r,source);
  assert.throws(()=>youtubeResource(p,{pageUrl:source}),/完整/);
  const bytes=Buffer.alloc(1024,17);const requests=[];
  const blob=await readYoutubeTrack(r.tracks[0],{fetcher:async(url,options)=>{requests.push({url,options});if(options.method==='HEAD'){assert.equal(new URL(url).searchParams.has('range'),false);return new Response(null,{headers:{'Content-Length':String(bytes.length)}});}const [a,b]=new URL(url).searchParams.get('range').split('-').map(Number);return new Response(bytes.subarray(a,b+1));}});
  assert.equal(requests.length,2);assert.deepEqual(Buffer.from(await blob.arrayBuffer()),bytes);
  assert.throws(()=>validateYoutubeResource({...r,tracks:[{...r.tracks[0],observed:false}]},source));
  assert.equal(await youtubeTrackSize(r.tracks[0],{fetcher:async(url,options)=>options.method==='HEAD'?new Response(null,{status:405}):new Response('x',{status:206,headers:{'Content-Range':'bytes 0-0/1024'}})}),1024);
  await assert.rejects(()=>youtubeTrackSize(r.tracks[0],{fetcher:async()=>new Response(null,{headers:{'Content-Length':String(501*1024*1024)}})}),/500/);
  await assert.rejects(()=>youtubeTrackSize(r.tracks[0],{fetcher:async()=>new Response(null)}),/大小/);
});
test('SABR binds the current work and complete audio/video formats to its observed playback session',()=>{
  const p=player();p.videoDetails.lengthSeconds='40';p.streamingData.serverAbrStreamingUrl='https://r1.googlevideo.com/videoplayback?id=work1&sabr=1';
  for(const f of p.streamingData.adaptiveFormats){delete f.url;f.lastModified='1696817551330113';f.approxDurationMs='40000';}
  const request={url:'https://r2.googlevideo.com/videoplayback?id=work1&sabr=1&sig=authorized',body:'AAAA'};
  const r=youtubeResource(p,{pageUrl:source,request});assert.equal(r.sabr.formats.length,2);assert.equal(r.tracks[0].itag,137);validateYoutubeResource(r,source);
  assert.throws(()=>youtubeResource(p,{pageUrl:source,request:{...request,url:request.url.replace('work1','other')}}),/会话/);
  assert.throws(()=>validateYoutubeResource({...r,sabr:{...r.sabr,formats:[]}},source),/不完整/);
  assert.throws(()=>validateYoutubeResource({...r,tracks:[{...r.tracks[0],size:1},r.tracks[1]]},source),/匹配/);
});
test('SABR request observation is tab/page scoped, bounded, expires and excludes unrelated requests',async()=>{
  const previous=globalThis.chrome,cache={};let page=source;
  globalThis.chrome={tabs:{get:async()=>({url:page})},storage:{session:{get:async key=>({[key]:cache[key]}),set:async value=>Object.assign(cache,value)}}};
  const request={url:'https://r1.googlevideo.com/videoplayback?id=work1&sabr=1',method:'POST',tabId:2,initiator:'https://www.youtube.com',requestBody:{raw:[{bytes:new Uint8Array([1,2,3]).buffer}]}};
  try{
    await observeYoutubePlayback({...request,initiator:'https://example.com'});assert.equal(await youtubePlaybackRequest(2,page),null);
    await observeYoutubePlayback(request);const result=await youtubePlaybackRequest(2,page);assert.equal(result.body,'AQID');assert.deepEqual(Object.keys(result).sort(),['body','url']);
    assert.equal(await youtubePlaybackRequest(3,page),null);assert.equal(await youtubePlaybackRequest(2,page+'&t=30'),null);
    await observeYoutubePlayback({...request,requestBody:{raw:[{bytes:new ArrayBuffer(128*1024+1)}]}});assert.equal((await youtubePlaybackRequest(2,page)).body,'AQID');
    cache.youtubePlaybackRequests[2].created=Date.now()-180001;assert.equal(await youtubePlaybackRequest(2,page),null);
  }finally{globalThis.chrome=previous;}
});
test('real FFmpeg merges uploaded picture + sound; auth, missing audio, remote references and cleanup',async()=>{
  const dir=await mkdtemp(resolve('artifacts/youtube-api-'));
  const runtime=createApp({dataDir:dir}),server=runtime.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const base='http://127.0.0.1:'+server.address().port;
  const video=join(dir,'picture.mp4'),audio=join(dir,'sound.m4a');
  try{
    await runMediaCommand(mediaTools().ffmpeg,['-v','error','-nostdin','-i',resolve('tests/fixtures/sample.mp4'),'-an','-c:v','copy',video]);
    await runMediaCommand(mediaTools().ffmpeg,['-v','error','-nostdin','-f','lavfi','-i','sine=frequency=400:duration=1','-threads','1','-c:a','aac',audio]);
    const form=async(audioName='audio.bin',audioPath=audio)=>{const f=new FormData();f.append('files',new Blob([await readFile(video)]),'video.bin');if(audioName)f.append('files',new Blob([await readFile(audioPath)]),audioName);f.set('title','YouTube 音画合并');f.set('source_url',source);return f;};
    assert.equal((await fetch(base+'/api/streams?format=pair',{method:'POST',body:await form()})).status,401);
    const cookie=(await fetch(base+'/api/auth/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'yt-test-1029'})})).headers.get('set-cookie').split(';')[0];
    const request=async(f,mode='download')=>fetch(base+'/api/streams?format=pair&mode='+mode,{method:'POST',headers:{Cookie:cookie},body:f});
    assert.equal((await request(await form(''))).status,400);
    assert.equal((await request(await form('audio.m3u8'))).status,400);
    assert.equal((await request(await form('audio.bin',video))).status,415);
    const res=await request(await form());assert.equal(res.status,200,await(res.ok?Promise.resolve(''):res.text()));
    const output=join(dir,'result.mp4');await writeFile(output,Buffer.from(await res.arrayBuffer()));
    const info=await runMediaCommand(mediaTools().ffmpeg,['-hide_banner','-i',output,'-map','0:v:0','-map','0:a:0','-f','null','-']);assert.match(info,/Audio: aac/);assert.match(info,/Video: h264/);
    const save=await request(await form(),'save');assert.equal(save.status,201);const item=await save.json();assert.equal(item.kind,'video');assert.equal(item.source_url,source);assert.ok(item.bytes>1000);
    for(let i=0;i<50&&(await readdir(join(dir,'uploads'))).length;i++)await new Promise(r=>setTimeout(r,20));
    assert.deepEqual(await readdir(join(dir,'uploads')),[]);
  }finally{await runtime.imports.stop();await runtime.backups.stop();await runtime.webhooks.stop();await new Promise(r=>server.close(r));runtime.db.close();await rm(dir,{recursive:true,force:true});}
});
