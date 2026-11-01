(() => {
  const valid=value=>{try{const u=new URL(value);return u.protocol==='https:'&&u.hostname==='video.twimg.com'&&!u.username&&!u.password&&!u.port&&/\.mp4$/i.test(u.pathname)&&!/(?:^|[/_-])init(?:[._/-]|$)/i.test(u.pathname)?u.href:'';}catch{return '';}};
  globalThis.ZNoteXVideoRecords=(root)=>{
    const seen=new WeakSet(),stack=[root],records=new Map();let examined=0;
    while(stack.length&&examined++<20000){
      const entry=stack.pop();if(!entry||typeof entry!=='object'||seen.has(entry)||typeof Node!=='undefined'&&entry instanceof Node)continue;seen.add(entry);
      const legacy=entry.legacy||entry,id=String(entry.rest_id||legacy.id_str||'');
      const media=legacy.extended_entities?.media||entry.mediaDetails||[];
      if(/^\d{1,40}$/.test(id)&&Array.isArray(media)){
        const variants=media.filter(m=>['video','animated_gif'].includes(m.type)).flatMap(m=>m.video_info?.variants||m.video?.variants||[]);
        if(entry.video?.variants)variants.push(...entry.video.variants);
        const urls=[...new Set(variants.map(v=>({url:valid(v.url||v.src),bitrate:Number(v.bitrate)||0})).filter(v=>v.url).sort((a,b)=>b.bitrate-a.bitrate).map(v=>v.url))].slice(0,16);
        const images=[...new Set(media.filter(m=>m.type==='photo').map(m=>m.media_url_https).filter(value=>{try{const u=new URL(value);return u.protocol==='https:'&&u.hostname==='pbs.twimg.com'&&!u.username&&!u.password&&!u.port&&u.pathname.startsWith('/media/');}catch{return false;}}))].slice(0,4);
        const videoMedia=media.filter(m=>['video','animated_gif'].includes(m.type));
        const videos=videoMedia.map(m=>[...new Set((m.video_info?.variants||m.video?.variants||[]).map(v=>({url:valid(v.url||v.src),bitrate:Number(v.bitrate)||0})).filter(v=>v.url).sort((a,b)=>b.bitrate-a.bitrate).map(v=>v.url))].slice(0,16));
        if(urls.length||images.length||videoMedia.length){const previous=records.get(id);records.set(id,{id,video_urls:urls.length?urls:previous?.video_urls||[],videos:videos.length&&videos.every(v=>v.length)?videos:previous?.videos||[],video_count:Math.max(videoMedia.length,previous?.video_count||0),video:videoMedia.length>0||!!previous?.video,images:images.length>=(previous?.images?.length||0)?images:previous.images});}
      }
      try{for(const child of Object.values(entry))if(child&&typeof child==='object')stack.push(child);}catch{}
    }
    return [...records.values()].slice(0,100);
  };
})();
