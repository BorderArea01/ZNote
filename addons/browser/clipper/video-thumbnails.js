(() => {
  // Posters are ordinary lazy images. Decode a missing poster only when the
  // user points at that card, never for every item discovered in the list.
  const cache=new Map();let active;
  globalThis.ZNoteVideoThumbnailCancel=()=>active?.cancel();
  globalThis.ZNoteVideoThumbnail=async url=>{
    if(cache.has(url))return cache.get(url);
    if(active?.url===url)return active.promise;
    active?.cancel();
    const video=document.createElement('video');video.muted=true;video.playsInline=true;video.crossOrigin='anonymous';video.preload='metadata';
    let settle,timer,done=false;
    const promise=new Promise(resolve=>settle=resolve);
    const finish=(image,cancelled=false)=>{
      if(done)return;done=true;clearTimeout(timer);video.onloadeddata=video.onerror=null;video.pause();video.removeAttribute('src');video.load();
      if(!cancelled){cache.set(url,image);while(cache.size>40)cache.delete(cache.keys().next().value)}
      if(active?.url===url)active=null;settle(image);
    };
    active={url,promise,cancel:()=>finish(null,true)};
    video.onloadeddata=()=>{try{const canvas=document.createElement('canvas');canvas.width=240;canvas.height=Math.max(1,Math.round(240*video.videoHeight/video.videoWidth));if(canvas.height>360){canvas.width=Math.max(1,Math.round(360*video.videoWidth/video.videoHeight));canvas.height=360}canvas.getContext('2d').drawImage(video,0,0,canvas.width,canvas.height);finish(canvas.toDataURL('image/jpeg',0.65))}catch{finish(null)}};
    video.onerror=()=>finish(null);timer=setTimeout(()=>finish(null),4000);video.src=url;video.load();return promise;
  };
})();
