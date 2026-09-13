(() => {
  const clean=(v,n=200)=>typeof v==='string'?v.replace(/\s+/g,' ').trim().slice(0,n):'';
  const http=v=>{try{const u=new URL(v);return /^https?:$/.test(u.protocol)&&!u.username&&!u.password&&u.href.length<4096?u.href:''}catch{return ''}};
  globalThis.ZNoteDouyinRecords=input=>{
    const found=[],seen=new WeakSet();let visited=0;
    const walk=(value,depth=0)=>{
      if(!value||typeof value!=='object'||depth>18||visited++>12000||seen.has(value))return;
      seen.add(value);
      const id=value.aweme_id||value.awemeId,person=value.author||value.authorInfo,video=value.video;
      if(typeof id==='string'&&/^\d+$/.test(id)&&person&&video){
        const urls=new Set();const addresses=(v,d=0)=>{
          if(!v||d>7)return;
          if(typeof v==='string'){const u=http(v);if(u&&!/media-audio|audio-only/i.test(u)&&!/\.(?:jpe?g|png|webp|gif)(?:$|[?~])/i.test(u))urls.add(u);return}
          if(Array.isArray(v)){for(const x of v.slice(0,40))addresses(x,d+1)}
          else if(typeof v==='object')for(const [k,x]of Object.entries(v))if(/play|download|url|bit.?rate|src|h264|h265|dash/i.test(k)&&!/cover|avatar|audio/i.test(k))addresses(x,d+1);
        };addresses(video);
        const cover=video.origin_cover||video.originCover||video.cover||video.dynamic_cover;
        const poster=http(cover?.url_list?.[0]||cover?.urlList?.[0]||cover?.url||cover);
        const sec=clean(person.sec_uid||person.secUid);
        found.push({id,work_id:id,title:clean(value.desc||value.description),author:clean(person.nickname||person.nickName),author_url:sec?'https://www.douyin.com/user/'+encodeURIComponent(sec):'',poster,source_url:'https://www.douyin.com/video/'+id,metadata_rank:3,urls:[...urls].slice(0,60)});
      }
      for(const [key,child]of Object.entries(value))if(!['return','child','sibling','stateNode','alternate','_owner'].includes(key))walk(child,depth+1);
    };
    walk(input);return found.slice(0,300);
  };
})();
