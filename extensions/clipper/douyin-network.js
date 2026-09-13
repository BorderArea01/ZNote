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
