import {youtubeResource,youtubeMediaUrl} from './youtube-formats.js';
if(window===top){
  // Resource Timing contains final, already-authorized playback requests.
  // Keep only the current page's small URL window; never read account cookies.
  let observed=[];
  try{new PerformanceObserver(list=>{for(const entry of list.getEntries())if(youtubeMediaUrl(entry.name))observed.push(entry.name);observed=observed.slice(-120);}).observe({type:'resource',buffered:true});}catch{}
  addEventListener('yt-navigate-start',()=>{observed=[];});
  addEventListener('message',event=>{
    if(event.source!==window||event.origin!==location.origin||event.data?.type!=='znote-youtube-read'||!/^[-\w]{16,64}$/.test(event.data.nonce||''))return;
    let result;
    try{
      const p=document.querySelector('#movie_player');
      if(p?.getAdState?.()===1)throw Error('广告播放中，请等待正片开始后采集');
      result={ok:true,resource:youtubeResource(p?.getPlayerResponse?.()||window.ytInitialPlayerResponse,{pageUrl:location.href,observed})};
    }catch(error){result={ok:false,error:error.message||'尚未获得当前视频的音画数据'};}
    window.postMessage({type:'znote-youtube-data',nonce:event.data.nonce,...result},location.origin);
  });
}
