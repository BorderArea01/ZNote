export function imageFilename(title, index, url, mime) {
  const clean = String(title).replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/^[. ]+|[. ]+$/g,'').slice(0,80) || '作品图片';
  const ext = {'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif','image/avif':'avif','image/bmp':'bmp'}[mime.split(';')[0]] || new URL(url).pathname.match(/\.(jpe?g|png|webp|gif|avif|bmp)$/i)?.[1];
  if(!ext)throw Error('无法确认图片格式');
  return `ZNote/${clean}/${String(index+1).padStart(3,'0')}.${ext.toLowerCase()}`;
}
export async function downloadBlob(blob, filename, signal) {
  signal.throwIfAborted();
  const url=URL.createObjectURL(blob);
  let id;
  try {
    id=await chrome.downloads.download({url,filename,conflictAction:'uniquify',saveAs:false});
    await new Promise((resolve,reject)=>{
      let done=false;
      const finish=error=>{if(done)return;done=true;clearTimeout(timer);chrome.downloads.onChanged.removeListener(change);signal.removeEventListener('abort',abort);error?reject(error):resolve();};
      const abort=()=>{chrome.downloads.cancel(id).catch(()=>{});finish(Error('已停止'));};
      const change=delta=>{if(delta.id!==id)return;if(delta.state?.current==='complete')finish();else if(delta.state?.current==='interrupted')finish(Error(delta.error?.current||'浏览器中断下载'));};
      const timer=setTimeout(()=>{chrome.downloads.cancel(id).catch(()=>{});finish(Error('下载超时，请重试'));},120000);
      chrome.downloads.onChanged.addListener(change);signal.addEventListener('abort',abort,{once:true});
      if(signal.aborted)return abort();
      chrome.downloads.search({id}).then(items=>{const item=items[0];if(item)change({id,state:{current:item.state},error:{current:item.error}});else finish(Error('下载记录已失效'));},finish);
    });
  } finally { URL.revokeObjectURL(url); }
}
