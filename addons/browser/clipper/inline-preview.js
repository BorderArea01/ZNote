import {isLikelyCompleteVideo} from './video-fetch.js';
const video=document.querySelector('#player'),status=document.querySelector('#status'),retry=document.querySelector('#retry');
let hls,manifest,resource,parentOrigin,timer,controller,generation=0,failed=false,closed=false;
function cleanup(){generation++;controller?.abort();clearTimeout(timer);hls?.destroy();hls=null;video.pause();video.removeAttribute('src');video.load();if(manifest)URL.revokeObjectURL(manifest);manifest=null;}
function error(text){if(closed)return;clearTimeout(timer);failed=true;document.body.dataset.state='failed';status.textContent=text;retry.hidden=false;controller?.abort();hls?.destroy();hls=null;video.pause();video.removeAttribute('src');video.load();}
async function begin(){
  cleanup();failed=false;document.body.dataset.state='loading';retry.hidden=true;status.textContent='正在尝试播放…';
  const current=generation;controller=new AbortController();
  timer=setTimeout(()=>error('加载超时：可能是分段、授权失效或网络不可达'),15000);
  if(resource.kind==='video'&&resource.bytes>0&&resource.bytes<=2*1024*1024){
    try{
      const response=await fetch(resource.url,{credentials:'include',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(6000)])});
      if(!response.ok)throw Error('unavailable');
      const reader=response.body.getReader(),chunks=[];let size=0;
      try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>2*1024*1024)throw Error('large');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
      if(current!==generation||closed)return;
      const complete=response.status===200&&(!Number(response.headers.get('content-length'))||Number(response.headers.get('content-length'))===size);
      const blob=new Blob(chunks,{type:response.headers.get('content-type')||'video/mp4'});
      if(complete&&!await isLikelyCompleteVideo(blob)){error('只有初始化片段，缺少可播放的视频数据');return;}
      if(complete)manifest=URL.createObjectURL(blob);
    }catch{}
    if(current!==generation||closed)return;
  }
  if(resource.kind==='hls'&&globalThis.Hls.isSupported()){
    hls=new Hls({enableWorker:false,maxBufferLength:8,maxMaxBufferLength:12,maxBufferSize:8*1024*1024,backBufferLength:0,maxBufferHole:.2,xhrSetup:xhr=>{xhr.withCredentials=true;}});
    if(resource.playlist_text)manifest=URL.createObjectURL(new Blob([resource.playlist_text],{type:'application/vnd.apple.mpegurl'}));
    hls.on(Hls.Events.ERROR,(_,data)=>{if(data.fatal)error(data.type===Hls.ErrorTypes.NETWORK_ERROR?'试播读取失败：地址可能已失效、受访问限制或分段不完整':'无法解码：可能只有初始化片段、分段缺失或编码不兼容');});
    hls.loadSource(manifest||resource.url);hls.attachMedia(video);
  }else video.src=manifest||resource.url;
  video.play().catch(e=>{if(e.name==='NotAllowedError'&&!failed){clearTimeout(timer);status.textContent='媒体已加载，点击播放器开始试播';}else if(e.name!=='AbortError'&&!failed)error('无法试播：可能是初始化片段、分段缺失或访问限制');});
}
function playing(){if(failed||closed||video.paused)return;if(!video.videoWidth){status.textContent='尚未解码出视频画面…';return;}clearTimeout(timer);document.body.dataset.state='playing';status.textContent='正在试播'+(Number.isFinite(video.duration)?' · '+Math.round(video.duration)+' 秒':'');}
for(const event of ['playing','loadeddata','resize'])video.addEventListener(event,playing);
video.addEventListener('error',()=>{if(resource&&!closed&&!failed&&video.getAttribute('src'))error('无法试播：资源可能只有初始化片段、已失效或编码不兼容');});
video.addEventListener('ended',()=>{if(!failed)status.textContent='试播结束 · '+Math.round(video.duration||0)+' 秒';});
retry.onclick=()=>begin();
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&!document.fullscreenElement&&!document.querySelector('[role="tooltip"]:not([hidden])')){
    event.preventDefault();if(parentOrigin)parent.postMessage({type:'znote-inline-preview-close',id:new URL(location.href).searchParams.get('id')},parentOrigin);
  }
});
addEventListener('pagehide',()=>{closed=true;cleanup();});
document.addEventListener('visibilitychange',()=>{if(document.hidden){video.pause();hls?.stopLoad();}else if(!failed)hls?.startLoad();});
try{
  const id=new URL(location.href).searchParams.get('id'),result=await chrome.runtime.sendMessage({type:'inline-preview-load',id});
  if(!result?.ok)throw Error(result?.error||'无法读取预览');resource=result.resource;parentOrigin=result.parent_origin;begin();
}catch(e){error(e.message);retry.hidden=true;}
