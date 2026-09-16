import {limitedImage} from './client.js';
import {imageFilename,downloadBlob} from './gallery-download.js';

export async function downloadBatch(group,persist,announce,rows,startNow){
  const $=id=>document.getElementById(id);let running=false,controller;
  document.querySelector('header span').textContent='ZNote · 套图下载';$('minimize').setAttribute('aria-label','收起下载窗口');
  $('summary').textContent=`${group.images.length} 张原图 · 按页码下载`;
  for(const el of document.querySelectorAll('main>label,#collection,#tags,.connection'))el.hidden=true;
  group.states=group.images.map((_,i)=>['done','failed'].includes(group.states?.[i])?group.states[i]:'pending');
  const draw=()=>{
    const done=group.states.filter(s=>s==='done').length;
    $('save').disabled=running||done===group.images.length;$('save').textContent=done===group.images.length?'全部已下载':group.started?'重试未完成':'下载全部';
    $('save-cancel').hidden=!running;$('save-cancel').textContent='停止下载';$('save-progress').max=group.images.length;$('save-progress').value=done;
    rows.forEach((row,i)=>row.textContent=({done:'已下载',pending:'待下载',active:'下载中…',failed:'下载失败'})[group.states[i]]);announce();
  };
  const start=async()=>{
    if(running)return;running=true;group.busy=true;group.started=true;controller=new AbortController();let lastError='';draw();
    try{
      await persist();
      for(let i=0;i<group.images.length;i++){
        if(controller.signal.aborted)break;if(group.states[i]==='done')continue;
        group.states[i]='active';draw();$('save-status').textContent=`正在下载 ${i+1} / ${group.images.length}`;
        try{const blob=await limitedImage(group.images[i],AbortSignal.any([controller.signal,AbortSignal.timeout(15000)]));await downloadBlob(blob,imageFilename(group.title,i,group.images[i],blob.type),controller.signal);group.states[i]='done';}
        catch(e){group.states[i]=controller.signal.aborted?'pending':'failed';lastError=e.message;rows[i].title=e.message;}
        await persist();
      }
    }catch(e){lastError=e.message;}
    finally{
      running=false;group.busy=false;await persist().catch(e=>lastError=e.message);draw();
      const done=group.states.filter(s=>s==='done').length,failed=group.states.filter(s=>s==='failed').length;
      $('save-status').textContent=`${controller.signal.aborted?'已停止。':''}已下载 ${done} / ${group.images.length} 张${failed?`，${failed} 张失败`:''}${lastError?'：'+lastError:done===group.images.length?'，保存在下载目录的 ZNote 文件夹。':''}`;
    }
  };
  $('save').onclick=e=>{if(e.isTrusted)start();};$('save-cancel').onclick=e=>{if(e.isTrusted)controller?.abort();};
  window.addEventListener('beforeunload',e=>{if(running){e.preventDefault();e.returnValue='';}});
  await persist();draw();$('save-status').textContent='可继续下载未完成图片';if(startNow)await start();
}
