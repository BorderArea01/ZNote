import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { z } from 'zod';
import { sharedUrls } from '../shared/share-input.js';
import { markdownImages, replaceMarkdownImages } from '../shared/markdown-images.js';
import { videoDetails } from '../shared/video-details.js';
import { fetchRemoteImage } from './remote-images.js';
import { fetchCapturePage, extractCapturePage } from './capture-page.js';
import { downloadVideo } from './imports.js';
import { downloadCaptureVideo } from './capture-video.js';
import {douyinWork,renderDouyinCapture} from './capture-browser.js';
const KEY = 'mobile_captures_v1';
const fail = (status, message) => Object.assign(Error(message), { status });
const stableId = value => { const h=createHash('sha256').update(value).digest('hex'); return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`; };
export const captureInput = z.object({ text: z.string().trim().min(1).max(16000), image_mode:z.enum(["group","note"]).default("note"), collection_id: z.string().nullable().default(null), tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]), request_id: z.string().regex(/^[a-zA-Z0-9:_-]{1,160}$/).optional() });
export function createCaptureManager({ db, dataDir, validateCollection, work, saveImage, saveNote, saveVideo, exists, page = fetchCapturePage, image = fetchRemoteImage, video = downloadVideo, captureVideo = downloadCaptureVideo }) {
  const read = () => JSON.parse(db.prepare('SELECT value FROM settings WHERE key=?').get(KEY)?.value || '[]');
  const write = jobs => {const text=JSON.stringify(jobs);if(text.length>16*1024*1024)throw fail(429,'采集记录已满，请清理完成或失败的任务');db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(KEY,text);};
  const patch = (id, changes) => { const jobs=read(), job=jobs.find(j=>j.id===id); if(job){Object.assign(job,changes);if(job.status==='completed')delete job.plan;write(jobs);} return job; };
  const exposed = ({input, plan, ...job}) => ({...job, collection_id: input.collection_id});
  let active, pending = Promise.resolve(), stopped=false;
  const prior = read(); let changed=false;
  for(const j of prior) if(['queued','running'].includes(j.status)){j.status='failed';j.message='服务曾重启，任务已保留，请重试';changed=true;}
  if(changed) write(prior);
  function existing(id, collection) {
    const item=exists(id);
    if(item && (item.deleted_at || item.collection_id !== collection)) throw fail(409,'本次采集的内容已删除或移动，未重新创建；请恢复后重试');
    return item;
  }
  async function process(job, signal) {
    validateCollection(job.input.collection_id);
    const id=stableId('capture:'+job.id), before=existing(id,job.input.collection_id);
    if(before){patch(job.id,{status:'completed',message:'已入库',item_id:id});return;}
    let plan=job.plan;
    if(!plan){
      const resource=await page(job.source_url,signal);signal.throwIfAborted();
      if(resource.plan) plan=resource.plan;
      if(plan){
        if(plan.content?.length>450000)throw fail(413,'正文过长，未入库');
        patch(job.id,{plan,title:plan.title||job.title});
      }
      else if(resource.type.startsWith('image/')){
        const item=await saveImage(resource.buffer,{id,title:job.input.text===job.source_url?'分享图片':job.input.text.slice(0,200),source_url:resource.url,collection_id:job.input.collection_id,tags:job.input.tags});
        patch(job.id,{status:'completed',message:'图片已入库',item_id:item.id,title:item.title});return;
      }
      else {
        try{plan=extractCapturePage(resource.buffer.toString('utf8'),resource.url);}catch(e){if(!douyinWork(resource.url))throw e;}
        if(douyinWork(resource.url)&&!plan?.images?.length&&!plan?.video_urls?.length){patch(job.id,{message:'正在读取抖音作品页面'});plan=await renderDouyinCapture(resource.url,signal);}
        if(plan.content?.length>450000)throw fail(413,'正文过长，未入库');
        patch(job.id,{plan,title:plan.title||job.title});
      }
    }
    signal.throwIfAborted();
    if(plan.kind==='video'){
      const root=join(dataDir,'capture-downloads');await mkdir(root,{recursive:true});
      const dir=await mkdtemp(join(root,'job-'));
      try{
        const options={url:plan.url,plan,dir,signal,progress:message=>patch(job.id,{message})};
        const file=await (plan.video_urls?.length?captureVideo(options):video(options));signal.throwIfAborted();
        const details=videoDetails({...file,title:file.title||plan.title,author:plan.author||file.author},job.input.tags);
        const item=await saveVideo(file,{...details,content:[details.content,file.description||''].filter(Boolean).join('\n\n'),source_url:plan.url,collection_id:job.input.collection_id});
        patch(job.id,{status:'completed',message:'视频已入库',item_id:item.id,title:item.title});
      }finally{await rm(dir,{recursive:true,force:true});}
      return;
    }
    const liveVideos=Array.isArray(plan.live_videos)?plan.live_videos.filter(v=>Number.isInteger(v.index)&&Array.isArray(v.urls)&&v.urls.length):[];
    const liveIndices=new Set(liveVideos.map(v=>v.index));
    // A motion-photo cover and its video contain the same moment. Store the
    // playable video directly and do not create a second still-image card.
    const galleryEntries=(plan.images||[]).map((url,sourceIndex)=>({url,sourceIndex})).filter(entry=>!liveIndices.has(entry.sourceIndex));
    const mediaCount=galleryEntries.length+liveVideos.length;
    const album=job.input.image_mode==='group'&&mediaCount>0;
    const liveOnly=liveVideos.length>0&&galleryEntries.length===0;
    const groupKey=liveOnly?(liveVideos.length>1?'capture:'+id:null):album?(mediaCount>1?'capture:'+id:null):'note:'+id;
    const tags=[...new Set([...job.input.tags, ...(plan.tags||[]).map(String).map(value=>value.slice(0,40)), ...(plan.author?[String(plan.author).slice(0,40)]:[])])].slice(0,30);
    let content=plan.content||'';
    if(galleryEntries.length)content += '\n\n'+galleryEntries.map(({url,sourceIndex})=>`![配图 ${sourceIndex+1}](<${url}>)`).join('\n\n');
    const urls=[...new Set(markdownImages(content).map(v=>v.url))];
    if(urls.length>100)throw fail(413,'单次正文配图最多 100 张');
    const galleryIndex=new Map(galleryEntries.map(entry=>[entry.url,entry.sourceIndex]));
    const mapping=new Map();let usedFallback=Boolean(job.image_fallback);
    for(const [index,url] of urls.entries()){
      signal.throwIfAborted();patch(job.id,{message:`正在保存配图 ${index+1}/${urls.length}`});
      const sourceIndex=galleryIndex.get(url)??index;
      const imageId=stableId(job.id+':image:'+sourceIndex);
      let item=existing(imageId,job.input.collection_id);
      if(item && item.group_key!==groupKey)throw fail(409,'已保存的配图被重新分组，请恢复后重试');
      if(!item){
        const candidates=plan.image_candidates?.find(values=>values[0]===url)||[url];let buffer,lastError;
        for(const [attempt,candidate] of candidates.entries()){
          signal.throwIfAborted();
          try { buffer=await image(candidate); if(attempt>0){usedFallback=true;patch(job.id,{image_fallback:true});} break; }
          catch(e){lastError=e;}
        }
        if(!buffer)throw lastError||fail(422,'配图无法下载');
        signal.throwIfAborted();item=await saveImage(buffer,{id:imageId,title:(plan.title||'网页配图').slice(0,180)+` · ${sourceIndex+1}`,source_url:plan.url,collection_id:job.input.collection_id,tags,content:album?plan.content||'':'',group_key:groupKey,group_index:sourceIndex,group_title:(plan.title||'网页采集').slice(0,200)});
      }
      mapping.set(url,`/media/${item.id}/original`);
    }
    let firstLiveItem;
    for(const [liveIndex,live] of liveVideos.entries()){
      signal.throwIfAborted();patch(job.id,{message:`正在保存实况片段 ${liveIndex+1}/${liveVideos.length}`});
      const root=join(dataDir,'capture-downloads');await mkdir(root,{recursive:true});const dir=await mkdtemp(join(root,'live-'));
      try{
        const file=await captureVideo({plan:{url:plan.url,title:`${plan.title||'实况图'} · 动态 ${liveIndex+1}`,author:plan.author,description:plan.content||'',video_urls:live.urls},dir,signal,progress:message=>patch(job.id,{message})});
        const details=videoDetails({...file,title:file.title,author:plan.author},tags);
        const saved=await saveVideo(file,{...details,content:[details.content,'原作品第 '+(Number(live.index)+1)+' 项实况内容'].filter(Boolean).join('\n\n'),source_url:plan.url,collection_id:job.input.collection_id,group_key:groupKey||undefined,group_index:live.index,group_title:(plan.title||'实况图').slice(0,200)});
        if(!firstLiveItem)firstLiveItem=saved;
      }finally{await rm(dir,{recursive:true,force:true});}
    }
    signal.throwIfAborted();validateCollection(job.input.collection_id);
    for(const [index,url] of urls.entries()){const sourceIndex=galleryIndex.get(url)??index;if(!existing(stableId(job.id+':image:'+sourceIndex),job.input.collection_id))throw fail(409,'配图已移除，请检查后重试');}
    if(album||liveOnly){const firstImage=urls.length?existing(stableId(job.id+':image:'+(galleryIndex.get(urls[0])??0)),job.input.collection_id):null;const first=firstImage||firstLiveItem;patch(job.id,{status:'completed',message:liveVideos.length?`${liveVideos.length} 段实况视频已入库${galleryEntries.length?`，另有 ${galleryEntries.length} 张静态图片`:''}`:usedFallback?'图片组已入库，使用了备用图片版本':'图片组已入库，正文已保存在备注',item_id:first?.id,title:plan.title});return;}
    content=replaceMarkdownImages(content,markdownImages(content),mapping);
    const item=saveNote({id,title:(plan.title||'网页采集').slice(0,200),content,source_url:plan.url,collection_id:job.input.collection_id,tags});
    patch(job.id,{status:'completed',message:usedFallback?'图文已入库；部分首选图片不可用，已使用备用版本，可能含平台水印':'图文已入库，配图已保存到本地',item_id:item.id,title:item.title});
  }
  async function pump(){
    if(active||stopped)return;
    while(!stopped){
      const job=read().find(j=>j.status==='queued');if(!job)return;
      const controller=new AbortController();active={id:job.id,controller};patch(job.id,{status:'running',message:'正在读取分享内容'});
      try{await work(()=>process(job,controller.signal));}
      catch(e){
        const message=controller.signal.aborted?'采集已停止，可重试':e.status?e.message:'网络或存储处理失败，请检查连接后重试';
        // Runtime diagnostics already persist stderr with rotation. Keep the
        // task id and failure stack, but omit source/share URLs and user text.
        console.error('[capture_failed]',JSON.stringify({id:job.id,message:e?.message||String(e),code:e?.code||null,status:e?.status||null}),e?.stack||'');
        patch(job.id,{status:'failed',message});
      }
      finally{active=null;}
    }
  }
  const schedule=()=>{pending=pending.then(pump).catch(()=>{});};
  const manager={
    recover(){const jobs=read();for(const j of jobs)if(['queued','running'].includes(j.status)){j.status='failed';j.message='恢复备份后任务已保留，请重试';}write(jobs);},
    list:()=>read().reverse().map(exposed),
    get(id){const job=read().find(j=>j.id===id);if(!job)throw fail(404,'采集记录不存在');return exposed(job);},
    add(raw){
      const input=captureInput.parse(raw);validateCollection(input.collection_id);
      const urls=sharedUrls(input.text);if(urls.length!==1)throw fail(400,'每次分享请包含一个完整链接');
      const jobs=read(), found=input.request_id&&jobs.find(j=>j.request_id===input.request_id);
      if(found){if(found.source_url!==urls[0]||found.input.collection_id!==input.collection_id||(found.input.image_mode||'note')!==input.image_mode)throw fail(409,'这次分享编号已用于其他内容');return exposed(found);}
      if(stopped)throw fail(503,'服务正在停止');
      if(jobs.filter(j=>['queued','running'].includes(j.status)).length>=16)throw fail(429,'采集队列已满，请稍后重试');
      while(jobs.length>=100){const index=jobs.findIndex(j=>j.status==='completed');if(index<0)throw fail(429,'请先处理失败的采集任务');jobs.splice(index,1);}
      const job={id:input.request_id?stableId(input.request_id):randomUUID(),request_id:input.request_id||null,input,source_url:urls[0],title:input.text.slice(0,100),created_at:new Date().toISOString(),status:'queued',message:'等待服务器采集'};
      jobs.push(job);write(jobs);schedule();return exposed(job);
    },
    retry(id){const job=this.get(id);if(job.status!=='failed')throw fail(409,'只有失败的采集任务可以重试');validateCollection(job.collection_id);const previous=read().find(j=>j.id===id);patch(id,{status:'queued',message:'等待重新采集',...(previous.plan?.kind==='video'?{plan:null}:{})});schedule();return this.get(id);},
    remove(id){const job=this.get(id);if(!['completed','failed'].includes(job.status))throw fail(409,'请等待任务结束后再移除记录');write(read().filter(j=>j.id!==id));return {removed:true};},
    async wait(id,signal){while(true){signal.throwIfAborted();const job=this.get(id);if(job.status==='completed')return job;if(job.status==='failed')throw fail(422,job.message);await sleep(200,undefined,{signal});}},
    async cancelAll(){for(const job of read())if(job.status==='queued')patch(job.id,{status:'failed',message:'采集已停止，可重试'});active?.controller.abort();await pending;},
    async stop(){stopped=true;await this.cancelAll();},
  };
  return manager;
}
