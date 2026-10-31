(() => {
  if(window!==top)return;
  chrome.runtime.onMessage.addListener((message,sender,reply)=>{
    if(sender.id!==chrome.runtime.id||message.type!=='youtube-current-video')return;
    if(message.url!==location.href){reply({ok:false,error:'页面已切换，请重新采集当前作品'});return;}
    const nonce=crypto.randomUUID();
    const finish=value=>{clearTimeout(timer);removeEventListener('message',receive);reply(value);};
    const receive=event=>{
      if(event.source===window&&event.origin===location.origin&&event.data?.type==='znote-youtube-data'&&event.data.nonce===nonce)finish(event.data);
    };
    const timer=setTimeout(()=>finish({ok:false,error:'未连接到 YouTube 播放器，请刷新视频页面后重试'}),5000);
    addEventListener('message',receive);
    window.postMessage({type:'znote-youtube-read',nonce},location.origin);
    return true;
  });
})();
