import {SabrStream} from 'googlevideo/sabr-stream';
import {VideoPlaybackAbrRequest} from 'googlevideo/protos';
import {buildSabrFormat,Logger,LogLevel} from 'googlevideo/utils';
import {youtubeMediaUrl} from './youtube-formats.js';
Logger.getInstance().setLogLevels(LogLevel.NONE);
const base64=bytes=>btoa(Array.from(bytes,b=>String.fromCharCode(b)).join(''));
export async function readYoutubeSabr(resource,{signal,onProgress=()=>{},fetcher=fetch}={}){
  const input=resource.sabr,captured=VideoPlaybackAbrRequest.decode(Uint8Array.from(atob(input.request),c=>c.charCodeAt(0)));
  if(!captured.streamerContext?.clientInfo||!captured.videoPlaybackUstreamerConfig?.length)throw Error('当前播放器的分段会话尚未就绪，请播放几秒后重试');
  const fetchFunction=async(value,options)=>{
    const url=youtubeMediaUrl(String(value));if(!url)throw Error('YouTube 分段地址无效');
    const request=VideoPlaybackAbrRequest.decode(options.body),context=request.streamerContext;
    request.streamerContext={...captured.streamerContext,...context,clientInfo:captured.streamerContext.clientInfo,poToken:context.poToken||captured.streamerContext.poToken,
      sabrContexts:context.sabrContexts?.length?context.sabrContexts:captured.streamerContext.sabrContexts,playbackCookie:context.playbackCookie||captured.streamerContext.playbackCookie};
    const response=await fetcher(url.href,{...options,headers:{'Content-Type':'application/x-protobuf','Accept':'application/vnd.yt-ump'},body:VideoPlaybackAbrRequest.encode(request).finish(),credentials:'omit',redirect:'error',signal:AbortSignal.any([options.signal,signal||new AbortController().signal,AbortSignal.timeout(45000)])});
    if(!response.ok)throw Error('YouTube 分段读取失败（'+response.status+'），请刷新并播放后重试');return response;
  };
  const stream=new SabrStream({videoId:resource.id.slice(8),serverAbrStreamingUrl:input.url,videoPlaybackUstreamerConfig:base64(captured.videoPlaybackUstreamerConfig),
    clientInfo:captured.streamerContext.clientInfo,poToken:captured.streamerContext.poToken?.length?base64(captured.streamerContext.poToken):undefined,
    formats:input.formats.map(buildSabrFormat),fetchFunction,videoHighWaterMark:2*1024*1024,audioHighWaterMark:512*1024});
  let total=0,last=0,finished=false,failure,complete=false;
  const cursor=[null,null],until=[0,0];
  stream.on('trackStateUpdate',collection=>{
    for(const [i,track] of [collection.video,collection.audio].entries()){
      if(track.formatId&&track.formatId.itag!==resource.tracks[i].itag){failure=Error('YouTube 返回的音画格式与当前作品不匹配');void stream.abort();return;}
      for(const segment of [...track.trackedSegments.values()].filter(s=>!s.mediaHeader.isInitializationSegment).sort((a,b)=>a.segmentNumber-b.segmentNumber)){
        if(cursor[i]!==null&&segment.segmentNumber<=cursor[i])continue;
        if(cursor[i]===null?segment.startTimeMs>500:segment.segmentNumber!==cursor[i]+1||segment.startTimeMs>until[i]+500){failure=Error('YouTube 分段缺失，未保存不完整视频');void stream.abort();return;}
        cursor[i]=segment.segmentNumber;until[i]=Math.max(until[i],segment.endTimeMs);
      }
    }
    complete=collection.video.endOfStreamReached&&collection.audio.endOfStreamReached;
  });
  stream.on('error',error=>{failure=error;});stream.on('finish',()=>{finished=true;});
  stream.on('streamProtectionStatusUpdate',state=>{if(state.status===3){failure=Error('YouTube 拒绝了当前分段播放授权，请在原页面完成平台验证后重试');void stream.abort();}});
  const abort=()=>{void stream.abort();};signal?.addEventListener('abort',abort,{once:true});
  try{
    signal?.throwIfAborted();onProgress('正在读取完整分段音画…');
    const output=stream.start({videoFormat:resource.tracks[0].itag,audioFormat:resource.tracks[1].itag,startTimeMs:0,isPostLiveDvr:false,maxRetries:1,stallDetectionMs:15000});
    const consume=async(readable,index)=>{const reader=readable.getReader(),parts=[];try{while(true){const {value,done}=await reader.read();if(done)break;total+=value.byteLength;if(total>500*1024*1024)throw Error('视频超过 500 MB，已停止读取');parts.push(new Blob([value]));if(Date.now()-last>350){last=Date.now();const time=Math.min(...until);onProgress('正在读取完整音画 '+Math.min(99,Math.floor(time/input.duration/10))+'% · '+(total/1048576).toFixed(1)+' MB');}}return new Blob(parts,{type:resource.tracks[index].mime.split(';')[0]});}finally{reader.releaseLock();}};
    const tracks=await Promise.all([consume(output.videoStream,0),consume(output.audioStream,1)]);
    if(failure)throw failure;
    if(!finished||!complete||tracks.some(t=>!t.size)||Math.min(...until)<input.duration*1000-2000)throw Error('YouTube 分段音画尚不完整，未保存片段');return tracks;
  }catch(error){await stream.abort();if(signal?.aborted)throw signal.reason;throw Error(failure?.message||(/YouTube|500 MB/.test(error.message)?error.message:'YouTube 分段读取失败或授权失效，未保存不完整视频'));}
  finally{signal?.removeEventListener('abort',abort);}
}
