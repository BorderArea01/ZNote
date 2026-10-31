import {validateYoutubeResource,youtubeMediaUrl} from './youtube-formats.js';
import {api,serverUrl} from './client.js';
import {videoDetails} from './video-details.js';
const chunkSize=8*1024*1024;
export async function readYoutubeTrack(track,{signal,onProgress=()=>{},fetcher=fetch}={}) {
  const base=youtubeMediaUrl(track.url);
  if(!base||!Number.isSafeInteger(track.size)||track.size<=0||track.size>500*1024*1024)throw Error('视频大小或播放流地址不正确');
  const chunks=[];
  // YouTube uses a query range in addition to HTTP Range. Retaining the
  // sniffed range would repeatedly download a single buffered fragment.
  for(let start=0;start<track.size;start+=chunkSize){
    const end=Math.min(track.size-1,start+chunkSize-1),url=new URL(base);
    url.searchParams.set('range',start+'-'+end);
    const response=await fetcher(url.href,{credentials:'omit',signal:AbortSignal.any([signal||new AbortController().signal,AbortSignal.timeout(45000)])});
    if(!response.ok)throw Error(response.status===403?'YouTube 播放授权已过期或服务器拒绝此播放流，请刷新并播放当前视频后重试':'YouTube 媒体读取失败（'+response.status+'），未保存不完整视频');
    const expected=end-start+1,parts=[];let size=0;
    if(!response.body)throw Error('播放流没有返回媒体数据');
    const reader=response.body.getReader();
    try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>expected)throw Error('YouTube 没有返回请求的媒体范围，已停止下载');parts.push(value);}}
    catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
    if(size!==expected)throw Error('YouTube 媒体分段不完整，未保存损坏视频');
    chunks.push(new Blob(parts));onProgress(Math.round((end+1)/track.size*100));
  }
  return new Blob(chunks,{type:track.mime.split(';')[0]});
}
export async function captureYoutube(resource,action,config,{signal,onProgress=()=>{},download}={}) {
  validateYoutubeResource(resource,resource.source_url);
  const tracks=[];
  for(let i=0;i<resource.tracks.length;i++)tracks.push(await readYoutubeTrack(resource.tracks[i],{signal,onProgress:p=>onProgress(`正在读取${i?'声音':'画面'} ${p}%`)}));
  if(tracks.length===1){
    if(action==='download'){await download(tracks[0]);return null;}
    const form=new FormData();form.set('file',tracks[0],'YouTube.'+(tracks[0].type.includes('webm')?'webm':'mp4'));
    const details=videoDetails(resource,config.tags.split(/[,，]/).map(t=>t.trim()).filter(Boolean));
    form.set('title',details.title);form.set('content',[details.content,resource.description].filter(Boolean).join('\n\n'));form.set('tags',JSON.stringify(details.tags));form.set('source_url',resource.source_url);
    if(config.collection_id)form.set('collection_id',config.collection_id);
    return api('/api/videos',{method:'POST',body:form,signal},config);
  }
  onProgress('画面与声音已读取，正在合并并验证…');
  const form=new FormData();tracks.forEach((blob,i)=>form.append('files',blob,i?'audio.bin':'video.bin'));
  const details=videoDetails(resource,config.tags.split(/[,，]/).map(t=>t.trim()).filter(Boolean));
  form.set('title',details.title);form.set('content',[details.content,resource.description].filter(Boolean).join('\n\n'));form.set('tags',JSON.stringify(details.tags));form.set('source_url',resource.source_url);
  if(config.collection_id)form.set('collection_id',config.collection_id);
  if(action==='save')return api('/api/streams?format=pair',{method:'POST',body:form,signal},config);
  const response=await fetch(serverUrl(config.server)+'/api/streams?format=pair&mode=download',{method:'POST',credentials:'omit',redirect:'error',headers:{Authorization:'Bearer '+config.token},body:form,signal});
  if(!response.ok){const value=await response.json().catch(()=>({}));throw Error(value.error||'音画合并失败');}
  await download(await response.blob());return null;
}
