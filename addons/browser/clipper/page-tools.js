// One owner for page actions and their feedback. No credentials or network API.
(() => {
  if (window !== top || !/^(?:www\.|mobile\.)?(?:x|twitter)\.com$/.test(location.hostname) || globalThis.ZNotePageTools) return;
  let host, root, bar, actions, feedback, text, close, timer, owner;
  const layout=new Set();
  const refresh = () => { bar.hidden = ![...actions.children].some(node => !node.hidden && !node.classList.contains('hidden')); };
  function mount() {
    if (host) {if(!host.isConnected)document.documentElement.append(host);return;}
    host = document.createElement('div'); host.dataset.znotePageTools = 'true';
    host.style.cssText = "all:initial!important;font:13px/1.5 system-ui,'Microsoft YaHei',sans-serif!important;color:#e9f2ed!important;position:fixed!important;right:18px!important;bottom:24px!important;z-index:2147483647!important;max-width:calc(100vw - 36px)!important;pointer-events:none!important";
    root = host.attachShadow({mode:'open'});
    const style = document.createElement('style');
    style.textContent = `:host{font:13px/1.5 system-ui,'Microsoft YaHei',sans-serif;color:#e9f2ed}*{box-sizing:border-box}[hidden],.hidden{display:none!important}.tools{max-width:min(340px,calc(100vw - 36px));border:1px solid #466052;border-radius:16px;background:#18251f;box-shadow:0 6px 24px #0005;pointer-events:auto;overflow:hidden}.actions{display:flex;align-items:stretch;padding:4px;gap:4px}.actions button{position:static!important;flex:1;min-height:38px;margin:0!important;border:0!important;border-radius:11px!important;background:transparent!important;color:#d5e4db!important;padding:8px 12px!important;font:600 12px/1.5 system-ui!important;cursor:pointer;box-shadow:none!important;white-space:nowrap}.actions button:hover{background:#304b3a!important}.actions button:focus-visible,.feedback button:focus-visible{outline:2px solid #9bc8ac;outline-offset:-3px}.actions button:disabled{opacity:.65;cursor:progress}.actions .znote-x-post-button{background:#345c43!important;color:#f0f7f2!important}.actions:has(.znote-x-post-button) .dock{border-left:1px solid #466052!important;border-radius:0 11px 11px 0!important;padding:8px 10px!important}.feedback{display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border-top:1px solid #3a5143;color:#c2d8cb;font-size:12px;line-height:1.6;overflow-wrap:anywhere;max-height:min(45vh,240px);overflow:auto;overscroll-behavior:contain}.feedback[data-error=true]{color:#efc6a0}.feedback span{flex:1;min-width:0}.feedback button{flex-shrink:0;background:none;border:0;color:inherit;font:20px/1 system-ui;cursor:pointer;width:28px;height:28px;border-radius:6px}`;
    bar=document.createElement('section');bar.className='tools';bar.setAttribute('aria-label','ZNote 页面采集工具');bar.hidden=true;
    actions=document.createElement('div');actions.className='actions';feedback=document.createElement('div');feedback.className='feedback';feedback.hidden=true;feedback.setAttribute('role','status');
    text=document.createElement('span');close=document.createElement('button');close.type='button';close.textContent='×';close.setAttribute('aria-label','关闭采集提示');close.onclick=()=>clear();
    feedback.append(text,close);bar.append(actions,feedback);root.append(style,bar);document.documentElement.append(host);
    new MutationObserver(refresh).observe(actions,{childList:true,subtree:true,attributes:true,attributeFilter:['class','hidden']});
    new ResizeObserver(()=>{for(const fn of layout)fn(bar.getBoundingClientRect().height);}).observe(bar);
    root.addEventListener('keydown',event=>{if(event.key==='Escape'){event.stopPropagation();clear();root.dispatchEvent(new CustomEvent('tools-close'));}});
  }
  function clear(key) { if(!feedback || (key && key!==owner))return;clearTimeout(timer);feedback.hidden=true;owner=null; }
  globalThis.ZNotePageTools = {
    register(key,node){mount();actions.querySelector(`[data-tool="${key}"]`)?.remove();node.dataset.tool=key;if(key==='post')actions.prepend(node);else actions.append(node);refresh();return node;},
    notice(message,{error=false,key='post'}={}){mount();clearTimeout(timer);owner=key;text.textContent=message;feedback.dataset.error=String(error);feedback.hidden=false;timer=setTimeout(()=>clear(key),error?20000:6000);},
    clear,
    get host(){return host;},
    onClose(fn){mount();root.addEventListener('tools-close',fn);},
    onLayout(fn){mount();layout.add(fn);fn(bar.getBoundingClientRect().height);},
  };
})();
