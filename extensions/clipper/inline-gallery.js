// The host gets progress only. Form controls and API credentials stay inside a
// separate extension-origin frame; no website message can start an upload.
globalThis.ZNoteInlineGallery=class {
  constructor(root){
    this.jobs=new Map();this.root=root;
    const css=new CSSStyleSheet();css.replaceSync('.inline-save{position:fixed;right:18px;bottom:24px;width:min(382px,calc(100vw - 24px));max-height:calc(100dvh - 36px);background:#171b26;color:#edf0fa;border:1px solid #485370;border-radius:16px;box-shadow:0 15px 60px #0008;overflow:hidden;z-index:2147483647;pointer-events:auto}.inline-save select{width:calc(100% - 24px);margin:10px 12px;max-width:100%}.inline-save iframe{display:block;border:0;width:100%;height:min(554px,calc(100dvh - 100px));background:#171b26}.inline-save[hidden],.inline-save iframe[hidden],.inline-save select[hidden],.inline-save-badge[hidden]{display:none!important}.inline-save-badge{position:fixed;right:18px;bottom:76px;background:#222b43;color:#ecf0ff;border:1px solid #8292da;border-radius:24px;padding:10px 15px;box-shadow:0 5px 22px #0005;z-index:2147483647;pointer-events:auto}');root.adoptedStyleSheets=[...root.adoptedStyleSheets,css];
    this.panel=document.createElement('div');this.panel.className='inline-save';this.panel.hidden=true;this.panel.setAttribute('role','region');this.panel.setAttribute('aria-label','ZNote 批量入库');
    this.select=document.createElement('select');this.select.setAttribute('aria-label','切换入库作品');this.select.hidden=true;this.select.onchange=()=>this.activate(this.select.value);this.panel.append(this.select);
    this.badge=document.createElement('button');this.badge.className='inline-save-badge';this.badge.hidden=true;this.badge.textContent='查看入库';this.badge.onclick=e=>{if(e.isTrusted){this.panel.hidden=false;this.badge.hidden=true;}};
    root.append(this.panel,this.badge);
    window.addEventListener('message',e=>{const m=e.data,j=this.jobs.get(m?.id);if(!j||e.source!==j.frame.contentWindow||e.origin!==new URL(j.frame.src).origin)return;
      if(m.type==='znote-inline-minimize'){this.panel.hidden=true;this.badge.hidden=false;this.updateBadge();}
      if(m.type==='znote-inline-progress'){j.running=!!m.running;j.done=Number(m.done)||0;j.total=Number(m.total)||0;j.option.textContent=String(m.title||'作品').slice(0,80)+` · ${j.done}/${j.total}`;if(Number.isFinite(m.height)&&m.height>0)j.frame.style.height=`min(${Math.max(260,Math.min(750,m.height))}px,calc(100dvh - 100px))`;this.updateBadge();}
    });
  }
  updateBadge(){const running=[...this.jobs.values()].filter(j=>j.running);this.badge.textContent=running.length?`入库中 · ${running.reduce((n,j)=>n+j.done,0)}/${running.reduce((n,j)=>n+j.total,0)}`:'查看入库';}
  activate(id){for(const [key,j]of this.jobs)j.frame.hidden=key!==id;this.select.value=id;this.panel.hidden=false;this.badge.hidden=true;}
  open(id,{minimized=false}={}){
    if(!this.jobs.has(id)){
      if(this.jobs.size>=10){const oldest=[...this.jobs].find(([,j])=>!j.running);if(oldest){oldest[1].frame.remove();oldest[1].option.remove();this.jobs.delete(oldest[0]);}}
      const frame=document.createElement('iframe'),option=new Option('作品入库',id);frame.title='ZNote 批量入库';frame.src=chrome.runtime.getURL('batch.html')+'?id='+encodeURIComponent(id);frame.setAttribute('referrerpolicy','no-referrer');frame.hidden=true;
      this.select.append(option);this.panel.append(frame);this.jobs.set(id,{frame,option,running:false,done:0,total:0});this.select.hidden=this.jobs.size<2;
    }
    this.activate(id);if(minimized){this.panel.hidden=true;this.badge.hidden=false;}
  }
};
