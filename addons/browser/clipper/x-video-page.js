// Page-world reader: expose only post-bound playback URLs, never session data.
(() => {
  if(window.top!==window||globalThis.__znoteXVideoPage)return;globalThis.__znoteXVideoPage=true;
  let enabled=false;const cache=new Map(),limit=4_000_000;
  const api=value=>{try{const u=new URL(value,location.href);return u.origin===location.origin&&/^\/i\/api\/graphql\//.test(u.pathname);}catch{return false;}};
  const remember=data=>{if(!enabled)return;for(const row of globalThis.ZNoteXVideoRecords(data)){cache.delete(row.id);cache.set(row.id,row);}while(cache.size>100)cache.delete(cache.keys().next().value);};
  window.addEventListener('znote-x-video-enabled',event=>{enabled=event.detail===true;if(!enabled)cache.clear();});
  window.addEventListener('znote-x-video-request',event=>{
    const {id,nonce}=event.detail||{};if(!enabled||!/^\d{1,40}$/.test(id||'')||typeof nonce!=='string')return;
    const roots=[],visited=new Set();
    for(const article of [...document.querySelectorAll('article[data-testid="tweet"]')].slice(0,50)){
      for(const start of [article,...article.querySelectorAll('video')])for(let node=start,depth=0;node&&depth<12;node=node.parentElement,depth++){
        if(visited.has(node))continue;visited.add(node);
        for(const key of Object.keys(node)){
          const props=key.startsWith('__reactProps$')?node[key]:key.startsWith('__reactFiber$')?node[key]?.memoizedProps:null;
          if(props&&typeof props==='object')roots.push(props);
        }
      }
    }
    remember(roots);
    const row=cache.get(id);window.dispatchEvent(new CustomEvent('znote-x-video-response',{detail:{id,nonce,video_urls:row?.video_urls||[]}}));
  });
  const originalFetch=window.fetch;
  window.fetch=function(...args){
    const result=Reflect.apply(originalFetch,this,args);
    if(api(args[0]?.url||args[0]))result.then(response=>{
      if(!enabled||!response.ok||Number(response.headers.get('content-length'))>limit)return;
      const reader=response.clone().body?.getReader();if(!reader)return;
      (async()=>{const chunks=[];let size=0;try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>limit||!enabled){await reader.cancel();return;}chunks.push(value);}const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}remember(JSON.parse(new TextDecoder().decode(bytes)));}catch{}finally{reader.releaseLock();}})();
    }).catch(()=>{});return result;
  };
  const open=XMLHttpRequest.prototype.open,send=XMLHttpRequest.prototype.send,requests=new WeakMap();
  XMLHttpRequest.prototype.open=function(method,url,...rest){requests.set(this,api(url));return Reflect.apply(open,this,[method,url,...rest]);};
  XMLHttpRequest.prototype.send=function(...args){if(requests.get(this))this.addEventListener('load',()=>{if(!enabled||this.status<200||this.status>=300)return;try{if(this.responseType==='json')remember(this.response);else if((!this.responseType||this.responseType==='text')&&this.responseText.length<=limit)remember(JSON.parse(this.responseText));}catch{}},{once:true});return Reflect.apply(send,this,args);};
})();
