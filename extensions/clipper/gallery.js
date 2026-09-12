import { limitedImage } from './client.js';
import { imageFilename, downloadBlob } from './gallery-download.js';
import './preview-cache.js';
const $=id=>document.getElementById(id);
let group, index=0, previewToken=0, running=false, controller, lastWheel=0;
const previewCache=new globalThis.ZNotePreviewCache(async(url,signal)=>{
  const blob=await limitedImage(url,AbortSignal.any([signal,AbortSignal.timeout(12000)]));return{url:URL.createObjectURL(blob)};
},value=>URL.revokeObjectURL(value.url));
const ticketKey='gallery-'+new URL(location.href).searchParams.get('id');
const states=[], buttons=[];
const persist=()=>chrome.storage.session.set({[ticketKey]:{...group,states:[...states],started:true}});
function draw() {
  $('counter').textContent=`${index+1} / ${group.images.length}`;
  $('previous').disabled=index===0;$('next').disabled=index===group.images.length-1;
  buttons.forEach((button,i)=>{button.setAttribute('aria-current',String(i===index));button.parentElement.dataset.state=states[i];button.lastChild.textContent=({done:'已下载',failed:'失败',active:'下载中…',pending:'待下载'})[states[i]];});
  const done=states.filter(s=>s==='done').length;
  $('progress').max=group.images.length;$('progress').value=done;
  $('download').disabled=running||done===group.images.length;
  $('download').textContent=done===group.images.length?'全部已下载':done||states.includes('failed')?'重试未完成':'下载全部';
  $('cancel').hidden=!running;
}
async function show(next, original=false) {
  if(!group||next<0||next>=group.images.length)return;
  index=next;draw();const token=++previewToken;
  const url=original?group.images[index]:(group.previews?.[index]||group.images[index]);
  const nearby=[index-1,index+1].filter(i=>i>=0&&i<group.images.length&&group.previews?.[i]&&group.previews[i]!==group.images[i]).map(i=>group.previews[i]);
  $('image').removeAttribute('src');previewCache.retain([url,...nearby]);
  $('original').hidden=(group.previews?.[index]||group.images[index])===group.images[index];
  $('preview-status').textContent=original?'正在加载原图…':'正在加载预览…';
  try {
    const value=await previewCache.get(url);
    if(token!==previewToken)return;
    $('image').onload=()=>{if(token===previewToken)$('preview-status').textContent=`${$('image').naturalWidth} × ${$('image').naturalHeight} · ${url===group.images[index]?'原图预览':'快速预览'}`;};
    $('image').onerror=()=>{$('preview-status').textContent='浏览器无法预览此图片，仍可尝试下载原文件';};
    $('image').src=value.url;for(const next of nearby)previewCache.get(next).catch(()=>{});
  } catch(e) {if(token===previewToken)$('preview-status').textContent='暂时无法预览：'+e.message;}
}
async function downloadAll() {
  if(!group||running)return;running=true;controller=new AbortController();draw();
  await persist();
  let lastError='';
  for(let i=0;i<group.images.length;i++) {
    if(controller.signal.aborted)break;if(states[i]==='done')continue;
    states[i]='active';draw();$('status').textContent=`正在下载 ${i+1} / ${group.images.length}…`;
    try {
      const blob=await limitedImage(group.images[i],AbortSignal.any([controller.signal,AbortSignal.timeout(15000)]));
      await downloadBlob(blob,imageFilename(group.title,i,group.images[i],blob.type),controller.signal);
      states[i]='done';
    } catch(e) {states[i]=controller.signal.aborted?'pending':'failed';lastError=e.message;buttons[i].title=e.message;}
    await persist();
  }
  running=false;draw();
  const done=states.filter(s=>s==='done').length, failed=states.filter(s=>s==='failed').length;
  $('status').textContent=`${controller.signal.aborted?'已停止。':''}已下载 ${done} / ${group.images.length} 张${failed?`，${failed} 张失败：${lastError}`:''}${done===group.images.length?'，保存在下载目录的 ZNote 文件夹。':'，可重试未完成项。'}`;
}
$('previous').onclick=()=>show(index-1);$('next').onclick=()=>show(index+1);
$('original').onclick=()=>show(index,true);
const startDownload=()=>downloadAll().catch(e=>{controller?.abort();running=false;draw();$('status').textContent='下载已停止：'+e.message;});
$('download').onclick=startDownload;$('cancel').onclick=()=>controller?.abort();
document.querySelector('.viewer').addEventListener('wheel',e=>{if(e.ctrlKey||!e.deltaY)return;e.preventDefault();if(Date.now()-lastWheel<220)return;lastWheel=Date.now();show(index+Math.sign(e.deltaY));},{passive:false});
document.addEventListener('keydown',e=>{if(e.ctrlKey||e.altKey||e.metaKey||e.repeat)return;if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();show(index+(e.key==='ArrowRight'?1:-1));}});
window.addEventListener('beforeunload',e=>{if(running){e.preventDefault();e.returnValue='';}});
try {
  group=(await chrome.storage.session.get(ticketKey))[ticketKey];
  if(!group||Date.now()-group.created>86400000)throw Error('作品列表已过期，请从原网页重新打开');
  $('title').textContent=group.title;$('source').href=group.source_url;
  group.images.forEach((url,i)=>{states.push(['done','failed'].includes(group.states?.[i])?group.states[i]:'pending');const li=document.createElement('li'),button=document.createElement('button'),label=document.createElement('b'),state=document.createElement('span');label.textContent=`第 ${i+1} 张`;button.append(label,state);button.onclick=()=>show(i);li.append(button);$('pages').append(li);buttons.push(button);});
  show(0);
  if(!group.started)startDownload();else $('status').textContent=`已下载 ${states.filter(s=>s==='done').length} / ${group.images.length} 张，可继续未完成的下载。`;
} catch(e) {$('status').textContent=e.message;$('title').textContent='无法打开作品';}
