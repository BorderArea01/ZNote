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
        if(urls.length)records.set(id,{id,video_urls:urls});
      }
      try{for(const child of Object.values(entry))if(child&&typeof child==='object')stack.push(child);}catch{}
    }
    return [...records.values()].slice(0,100);
  };
})();
