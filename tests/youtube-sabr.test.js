import test from 'node:test';
import assert from 'node:assert/strict';
import {VideoPlaybackAbrRequest,StreamerContext,FormatInitializationMetadata,MediaHeader,UMPPartId} from 'googlevideo/protos';
import {CompositeBuffer,UmpWriter} from 'googlevideo/ump';
import {concatenateChunks} from 'googlevideo/utils';
import {readYoutubeSabr} from '../addons/browser/clipper/youtube-sabr-source.js';
const resource=()=>{
  const formats=[{itag:137,mimeType:'video/mp4; codecs="avc1.640028"',height:720,qualityLabel:'720p',bitrate:1000000},{itag:140,mimeType:'audio/mp4; codecs="mp4a.40.2"',audioQuality:'AUDIO_QUALITY_MEDIUM',bitrate:128000}].map(f=>({...f,lastModified:'1696817551330113',contentLength:'1000',approxDurationMs:'40000'}));
  const message=VideoPlaybackAbrRequest.decode(new Uint8Array());message.streamerContext={...StreamerContext.decode(new Uint8Array()),clientInfo:{clientName:1,clientVersion:'2.20261101.00.00'},poToken:new Uint8Array([11,22])};message.videoPlaybackUstreamerConfig=new Uint8Array([5,6]);const body=VideoPlaybackAbrRequest.encode(message).finish();
  return {id:'youtube:TuR6De4SI5c',tracks:formats.map(f=>({itag:f.itag,mime:f.mimeType,size:1000})),sabr:{url:'https://r1.googlevideo.com/videoplayback?id=work1&sabr=1',request:Buffer.from(body).toString('base64'),formats,duration:40}};
};
function payload(value,{gap=false,wrongFormat=false}={}){
  const buffer=new CompositeBuffer(),writer=new UmpWriter(buffer);
  for(const [index,format] of value.sabr.formats.entries()){
    const itag=wrongFormat&&index===0?136:format.itag,formatId={itag,lastModified:format.lastModified},segment=gap?2:1;
    writer.write(UMPPartId.FORMAT_INITIALIZATION_METADATA,FormatInitializationMetadata.encode({videoId:'TuR6De4SI5c',formatId,mimeType:format.mimeType,endTimeTicks:'40000',endTimeTimescale:'1000',endSegmentNum:String(segment)}).finish());
    writer.write(UMPPartId.MEDIA_HEADER,MediaHeader.encode({videoId:'TuR6De4SI5c',headerId:index,itag,formatId,segmentNum:segment,segmentLengthBytes:'3',startMs:gap?'20000':'0',durationMs:gap?'20000':'40000'}).finish());
    writer.write(UMPPartId.MEDIA,new Uint8Array([index,1,2,3]));writer.write(UMPPartId.MEDIA_END,new Uint8Array([index]));
  }
  return concatenateChunks(buffer.chunks);
}
test('SABR reads both complete tracks using the observed client session without account cookies',async()=>{
  const r=resource();let calls=0;const tracks=await readYoutubeSabr(r,{fetcher:async(url,options)=>{
    calls++;assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,undefined);
    const request=VideoPlaybackAbrRequest.decode(options.body);assert.equal(request.streamerContext.clientInfo.clientName,1);assert.deepEqual(request.streamerContext.poToken,new Uint8Array([11,22]));
    assert.equal(Number(request.clientAbrState.playerTimeMs),0);return new Response(payload(r),{headers:{'Content-Type':'application/vnd.yt-ump'}});
  }});assert.equal(calls,1);assert.deepEqual(tracks.map(t=>t.size),[3,3]);
});
test('SABR rejects missing beginning, wrong format and expired media instead of returning partial files',async()=>{
  for(const mode of [{gap:true},{wrongFormat:true}]){const r=resource();await assert.rejects(()=>readYoutubeSabr(r,{fetcher:async()=>new Response(payload(r,mode),{headers:{'Content-Type':'application/vnd.yt-ump'}})}),mode.gap?/分段缺失/:/格式.*匹配/);}
  let calls=0;await assert.rejects(()=>readYoutubeSabr(resource(),{fetcher:async()=>{calls++;return new Response(null,{status:403});}}),/403/);assert.equal(calls,2);
});
