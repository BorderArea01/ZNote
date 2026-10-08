import {api, limitedImage} from './client.js';
import {readPlayableVideo} from './video-fetch.js';
import {imageFilename} from './gallery-download.js';

export async function downloadWork(resource, config, download, progress, dependencies = {}) {
  const resolve=dependencies.resolve || (async()=> (await api('/api/captures/resolve',{
    method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(65000),
    body:JSON.stringify({text:resource.text,...(resource.browserHtml?{browser_html:resource.browserHtml}:{})}),
  },config)).plan);
  await progress('正在解析作品资源…');
  const plan=await resolve();
  const lives=Array.isArray(plan.live_videos)?plan.live_videos.filter(v=>Number.isInteger(v.index)&&v.urls?.length):[];
  const liveIndices=new Set(lives.map(v=>v.index));
  const entries=[];
  if(!resource.videoOnly)for(const [i,url] of (plan.images||[]).entries()){
    if(!liveIndices.has(i))entries.push({kind:'image',urls:plan.image_candidates?.find(c=>c[0]===url)||[url],index:i});
  }
  for(const v of lives)entries.push({kind:'video',urls:v.urls,index:v.index});
  if(plan.video_urls?.length)entries.push({kind:'video',urls:plan.video_urls,index:entries.length});
  const title=String(plan.title||resource.title||'网页作品').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/^[. ]+|[. ]+$/g,'').slice(0,80)||'网页作品';
  if(!entries.length){
    if(resource.videoOnly||plan.kind==='video')throw Error('作品没有提供可下载的视频直链，请播放视频后使用媒体嗅探');
    if(!plan.content?.trim())throw Error('作品没有提供可下载的图片、视频或正文');
    await download(new Blob([`# ${plan.title||title}\n\n${plan.content}\n\n来源：${plan.url}\n`],{type:'text/markdown;charset=utf-8'}),`ZNote/${title}.md`);
    return {count:1};
  }
  let done=0;const failures=[];
  for(const [i,entry] of entries.entries()){
    await progress(`正在下载${entry.kind==='video'?'视频':'图片'} ${i+1}/${entries.length}`);
    let blob,lastError;
    for(const url of entry.urls){
      try{blob=await (entry.kind==='image'?(dependencies.image||limitedImage)(url):(dependencies.video||readPlayableVideo)(url,{signal:AbortSignal.timeout(300000)}));break;}
      catch(e){lastError=e;}
    }
    try{
      if(!blob)throw lastError||Error('资源无法读取');
      const filename=entry.kind==='video'?`ZNote/${title}/${String(entry.index+1).padStart(3,'0')}.mp4`:imageFilename(title,entry.index,entry.urls[0],blob.type);
      await download(blob,filename);done++;
    }catch(e){failures.push(`第 ${i+1} 项：${e.message}`);}
  }
  if(failures.length)throw Error(`已下载 ${done}/${entries.length} 项，${failures.length} 项失败，其他资源已继续处理：${failures.join('；').slice(0,500)}`);
  return {count:done};
}
