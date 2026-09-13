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
        const cover=video.cover||video.origin_cover||video.originCover||video.dynamic_cover;
        const poster=http(cover?.url_list?.[0]||cover?.urlList?.[0]||cover?.url||cover);
        const sec=clean(person.sec_uid||person.secUid);
        found.push({id,work_id:id,title:clean(value.desc||value.description),author:clean(person.nickname||person.nickName),author_url:sec?'https://www.douyin.com/user/'+encodeURIComponent(sec):'',poster,source_url:'https://www.douyin.com/video/'+id,metadata_rank:3,urls:[...urls].slice(0,60)});
      }
      for(const [key,child]of Object.entries(value))if(!['return','child','sibling','stateNode','alternate','_owner'].includes(key))walk(child,depth+1);
    };
    walk(input);return found.slice(0,300);
  };
})();

// Runs in the page world. Only public work metadata crosses to the extension;
// never expose request headers, cookies, raw responses or extension settings.
(() => {
  if(!/(^|\.)(douyin|iesdouyin)\.com$/.test(location.hostname))return;
  let enabled=false;
  const examined=new WeakMap();
  const limit=2_000_000;
  const api=value=>{try{const u=new URL(value,location.href);return u.origin===location.origin&&/^\/aweme\/v\d+\//.test(u.pathname)}catch{return false}};
  const emit=data=>{if(!enabled)return;const rows=globalThis.ZNoteDouyinRecords(data);if(rows.length)window.postMessage({type:'znote-douyin-works',rows},location.origin)};
  const snapshot=()=>{
    if(!enabled)return;
    const visited=new Set(),rows=new Map();
    for(const video of [...document.querySelectorAll('video')].slice(0,20)){
      for(let node=video,depth=0;node&&depth<12;node=node.parentElement,depth++){
        if(visited.has(node))continue;visited.add(node);
        let matched=false;
        for(const key of Object.keys(node)){
          const props=key.startsWith('__reactProps$')?node[key]:key.startsWith('__reactFiber$')?node[key]?.memoizedProps:null;
          if(props&&typeof props==='object'){let records=examined.get(props);if(!records){records=globalThis.ZNoteDouyinRecords(props);examined.set(props,records)}for(const row of records)rows.set(row.id,row);matched ||= records.length>0}
        }
        if(matched)break;
      }
    }
    if(rows.size)window.postMessage({type:'znote-douyin-works',rows:[...rows.values()].slice(0,300)},location.origin);
  };
  window.addEventListener('message',event=>{
    if(event.source!==window||event.origin!==location.origin||event.data?.type!=='znote-douyin-observe')return;
    const wasEnabled=enabled;enabled=event.data.enabled===true;
    if(enabled&&(!wasEnabled||event.data.snapshot===true))snapshot();
  });
  const originalFetch=window.fetch;
  window.fetch=function(...args){
    const result=Reflect.apply(originalFetch,this,args);
    if(api(args[0]?.url||args[0]))result.then(response=>{
      if(!enabled||!response.ok||Number(response.headers.get('content-length'))>limit)return;
      const reader=response.clone().body?.getReader();if(!reader)return;
      (async()=>{const chunks=[];let length=0;try{while(true){const {value,done}=await reader.read();if(done)break;length+=value.length;if(length>limit||!enabled){reader.cancel().catch(()=>{});return}chunks.push(value)}const bytes=new Uint8Array(length);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length}emit(JSON.parse(new TextDecoder().decode(bytes)))}catch{}finally{reader.releaseLock()}})();
    }).catch(()=>{});
    return result;
  };
  const originalOpen=XMLHttpRequest.prototype.open,originalSend=XMLHttpRequest.prototype.send,requests=new WeakMap();
  XMLHttpRequest.prototype.open=function(method,url,...rest){requests.set(this,api(url));return Reflect.apply(originalOpen,this,[method,url,...rest])};
  XMLHttpRequest.prototype.send=function(...args){
    if(requests.get(this))this.addEventListener('load',()=>{if(!enabled||this.status<200||this.status>=300)return;try{if(this.responseType==='json')emit(this.response);else if((!this.responseType||this.responseType==='text')&&this.responseText.length<=limit)emit(JSON.parse(this.responseText))}catch{}},{once:true});
    return Reflect.apply(originalSend,this,args);
  };
})();
