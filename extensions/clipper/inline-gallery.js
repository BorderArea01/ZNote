// The host gets progress only. Form controls and API credentials stay inside a
// separate extension-origin frame; no website message can start an upload.
globalThis.ZNoteInlineGallery=class {
  constructor(root,{persistent=false}={}){
    this.jobs=new Map();this.root=root;this.persistent=persistent;
    const css=new CSSStyleSheet();css.replaceSync('.inline-save{position:fixed;right:18px;bottom:24px;width:min(382px,calc(100vw - 24px));max-height:calc(100dvh - 36px);background:#171b26;color:#edf0fa;border:1px solid #485370;border-radius:16px;box-shadow:0 15px 60px #0008;overflow:hidden;display:flex;flex-direction:column;z-index:2147483647;pointer-events:auto}.inline-save select{width:calc(100% - 24px);margin:10px 12px;max-width:100%}.inline-heading,.paw-tools,.inline-save select{flex-shrink:0}.inline-save iframe{display:block;min-height:120px;flex-shrink:1;border:0;width:100%;height:min(554px,calc(100dvh - 100px));background:#171b26}.inline-save[hidden],.inline-save iframe[hidden],.inline-save select[hidden],.inline-save-badge[hidden]{display:none!important}.inline-save-badge{position:fixed;right:18px;bottom:76px;background:#222b43;color:#ecf0ff;border:1px solid #8292da;border-radius:24px;padding:10px 15px;box-shadow:0 5px 22px #0005;z-index:2147483647;pointer-events:auto}');root.adoptedStyleSheets=[...root.adoptedStyleSheets,css];
    this.panel=document.createElement('div');this.panel.className='inline-save';this.panel.hidden=true;this.panel.setAttribute('role','region');this.panel.setAttribute('aria-label','ZNote 批量入库');
    const heading=document.createElement('div');heading.className='inline-heading';heading.style.cssText='display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid #3a4259';
    const drag=document.createElement('button');drag.textContent='⠿';drag.setAttribute('aria-label','拖动套图面板');drag.style.touchAction='none';
    const title=document.createElement('strong');title.textContent=persistent?'Paw 套图助手':'批量任务';title.style.flex='1';
    const close=document.createElement('button');close.textContent='收起';close.setAttribute('aria-label','收起套图面板');close.onclick=e=>{if(e.isTrusted)this.minimize();};heading.append(drag,title,close);this.panel.append(heading);
    let moving;const place=(x,y)=>{const r=this.panel.getBoundingClientRect();this.panel.style.right='auto';this.panel.style.bottom='auto';this.panel.style.left=Math.max(8,Math.min(innerWidth-r.width-8,x))+'px';this.panel.style.top=Math.max(8,Math.min(innerHeight-r.height-8,y))+'px';};
    drag.onpointerdown=e=>{if(!e.isTrusted||e.button!==0)return;const r=this.panel.getBoundingClientRect();moving={x:e.clientX,y:e.clientY,left:r.left,top:r.top};drag.setPointerCapture(e.pointerId);};
    drag.onpointermove=e=>{if(moving)place(moving.left+e.clientX-moving.x,moving.top+e.clientY-moving.y);};
    const remember=()=>chrome.runtime.sendMessage({type:'media-gallery-position',position:{x:parseFloat(this.panel.style.left),y:parseFloat(this.panel.style.top)}}).catch(()=>{});
    drag.onpointerup=()=>{if(moving){moving=null;remember();}};drag.onpointercancel=()=>moving=null;
    drag.onkeydown=e=>{if(!e.isTrusted||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();const r=this.panel.getBoundingClientRect();place(r.left+(e.key==='ArrowLeft'?-20:e.key==='ArrowRight'?20:0),r.top+(e.key==='ArrowUp'?-20:e.key==='ArrowDown'?20:0));remember();};
    this.clamp=()=>{if(this.panel.style.left)place(parseFloat(this.panel.style.left),parseFloat(this.panel.style.top));};window.addEventListener('resize',this.clamp);
    chrome.runtime.sendMessage({type:'media-gallery-position'}).then(result=>{const p=result?.value;if(Number.isFinite(p?.x)&&Number.isFinite(p?.y)){this.panel.style.left=p.x+'px';this.panel.style.top=p.y+'px';this.panel.style.right=this.panel.style.bottom='auto';}}).catch(()=>{});
    this.select=document.createElement('select');this.select.setAttribute('aria-label','切换入库作品');this.select.hidden=true;this.select.onchange=()=>this.activate(this.select.value);this.panel.append(this.select);
    this.select.style.cssText='font:inherit;color:#edf0fa;background:#22283b;border:1px solid #4a5571;border-radius:8px;padding:7px;color-scheme:dark';
    this.badge=document.createElement('button');this.badge.className='inline-save-badge';this.badge.hidden=!persistent;this.badge.textContent=persistent?'▦ 套图助手':'查看入库';this.badge.onclick=e=>{if(e.isTrusted)this.show();};
    root.append(this.panel,this.badge);
    window.addEventListener('message',e=>{const m=e.data,j=this.jobs.get(m?.id);if(!j||e.source!==j.frame.contentWindow||e.origin!==new URL(j.frame.src).origin)return;
      if(m.type==='znote-inline-minimize')this.minimize();
      if(m.type==='znote-inline-progress'){j.action=m.action;j.running=!!m.running;j.done=Number(m.done)||0;j.total=Number(m.total)||0;j.option.textContent=String(m.title||'作品').slice(0,80)+` · ${j.done}/${j.total}`;if(Number.isFinite(m.height)&&m.height>0)j.frame.style.height=`min(${Math.max(260,Math.min(750,m.height))}px,calc(100dvh - 100px))`;this.updateBadge();}
    });
  }
  show(){this.panel.hidden=false;this.badge.hidden=true;requestAnimationFrame(this.clamp);this.onShow?.();}
  minimize(){this.panel.hidden=true;this.badge.hidden=false;this.updateBadge();}
  setTools(node){this.panel.insertBefore(node,this.select);}
  updateBadge(){const running=[...this.jobs.values()].filter(j=>j.running);this.badge.textContent=running.length?`${running.every(j=>j.action!=='download')?'入库中':'处理中'} · ${running.reduce((n,j)=>n+j.done,0)}/${running.reduce((n,j)=>n+j.total,0)}`:this.persistent?'▦ 套图助手':'查看入库';}
  activate(id){for(const [key,j]of this.jobs)j.frame.hidden=key!==id;this.select.value=id;this.show();}
  open(id,{minimized=false}={}){
    if(!this.jobs.has(id)){
      if(this.jobs.size>=10){const oldest=[...this.jobs].find(([,j])=>!j.running);if(oldest){oldest[1].frame.remove();oldest[1].option.remove();this.jobs.delete(oldest[0]);}}
      const frame=document.createElement('iframe'),option=new Option('作品入库',id);frame.title='ZNote 批量入库';frame.src=chrome.runtime.getURL('batch.html')+'?id='+encodeURIComponent(id);frame.setAttribute('referrerpolicy','no-referrer');frame.hidden=true;
      this.select.append(option);this.panel.append(frame);this.jobs.set(id,{frame,option,running:false,done:0,total:0});this.select.hidden=this.jobs.size<2;
    }
    this.activate(id);if(minimized){this.panel.hidden=true;this.badge.hidden=false;}
  }
};
