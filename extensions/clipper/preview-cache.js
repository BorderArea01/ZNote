// Each viewer retains only its current page and the two adjacent previews.
globalThis.ZNotePreviewCache = class {
  constructor(load, dispose = () => {}) { this.load=load;this.dispose=dispose;this.entries=new Map(); }
  retain(urls) {const keep=new Set(urls);for(const [url,entry] of this.entries)if(!keep.has(url)){this.entries.delete(url);entry.controller.abort();if(entry.value)this.dispose(entry.value);}}
  get(url) {
    if(this.entries.has(url))return this.entries.get(url).promise;
    const entry={controller:new AbortController()};this.entries.set(url,entry);
    entry.promise=Promise.resolve().then(()=>this.load(url,entry.controller.signal)).then(value=>{
      if(this.entries.get(url)!==entry){this.dispose(value);throw Error('预览请求已取消');}entry.value=value;return value;
    },error=>{if(this.entries.get(url)===entry)this.entries.delete(url);throw error;});
    entry.promise.catch(()=>{});return entry.promise;
  }
  clear(){this.retain([]);}
};
globalThis.ZNoteLoadPreview = (url, policy, signal) => new Promise((resolve,reject)=>{
  const img=new Image();let done=false;
  const finish=error=>{if(done)return;done=true;clearTimeout(timer);signal.removeEventListener('abort',abort);img.onload=null;img.onerror=null;error?reject(error):resolve(img);};
  const abort=()=>{finish(Error('预览请求已取消'));img.src='';};
  const timer=setTimeout(()=>{finish(Error('预览加载超时'));img.src='';},12000);
  signal.addEventListener('abort',abort,{once:true});if(signal.aborted)return abort();
  img.onload=()=>finish();img.onerror=()=>finish(Error('预览图片加载失败'));img.referrerPolicy=policy;img.src=url;
});
