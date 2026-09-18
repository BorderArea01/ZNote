// One reusable source toolbar and one persistent task panel. No per-card listeners
// or background downloads: only trusted clicks create download/save tickets.
globalThis.ZNotePawControls=class {
  constructor(root,gallery,send){
    this.root=root;this.gallery=gallery;this.send=send;this.enabled=true;this.route=location.href;this.target=null;this.busy=false;this.generation=0;
    const make=(tag,text)=>{const el=document.createElement(tag);el.textContent=text||'';return el;};
    const sheet=new CSSStyleSheet();sheet.replaceSync('.paw-source{position:fixed;z-index:2147483647;display:flex;gap:4px;padding:5px;background:#1c2132;border:1px solid #737fa8;border-radius:11px;box-shadow:0 4px 20px #0006;pointer-events:auto}.paw-source[hidden]{display:none!important}.paw-source button{padding:6px 8px;font-size:12px;min-height:34px;white-space:nowrap}.paw-tools{padding:12px;border-bottom:1px solid #3a4259}.paw-tools strong{display:block;overflow-wrap:anywhere;max-height:4.5em;overflow:auto}.paw-actions{display:flex;gap:6px;margin-top:10px;flex-wrap:wrap}.paw-primary{background:#5865ce!important;border-color:#8491ef!important;color:#fff!important;font-weight:650}.paw-status{font-size:12px;color:#cbd3e8;overflow-wrap:anywhere;margin:8px 0 0}.paw-status:empty{display:none}');root.adoptedStyleSheets=[...root.adoptedStyleSheets,sheet];
    this.toolbar=make('div');this.toolbar.className='paw-source';this.toolbar.hidden=true;this.toolbar.setAttribute('role','toolbar');this.toolbar.setAttribute('aria-label','Paw 图片快捷操作');root.append(this.toolbar);
    this.toolbar.style.color='#edf0fa';
    this.tools=make('section');this.tools.className='paw-tools';this.title=make('strong','当前作品');this.status=make('p');this.status.className='paw-status';this.status.setAttribute('role','status');const actions=make('div');actions.className='paw-actions';
    this.tools.append(this.title,actions,this.status);gallery.setTools(this.tools);gallery.onShow=()=>this.describe();
    this.buttons=[];const action=(parent,text,label,mode,primary=false)=>{const b=make('button',text);b.type='button';b.setAttribute('aria-label',label);if(primary)b.classList.add('paw-primary');b.onclick=e=>{if(!e.isTrusted)return;e.preventDefault();e.stopPropagation();this.run(mode);};this.buttons.push(b);parent.append(b);};
    action(this.toolbar,'整组入库','此作品整组入库','save',true);action(this.toolbar,'本图入库','保存当前图片到知识库','single-save');action(this.toolbar,'↓ 下载套图','下载此作品套图','download');
    action(actions,'整组入库','保存当前套图到知识库','save',true);action(actions,'本图入库','保存当前图片到知识库','single-save');
    const retry=make('button','重新识别');retry.onclick=e=>{if(e.isTrusted){this.target=null;this.describe();window.dispatchEvent(new Event('znote-work-updated'));}};actions.append(retry);
    document.addEventListener('pointermove',e=>{
      if(!e.isTrusted||!this.enabled||this.busy)return;this.checkRoute();
      if(e.composedPath().includes(this.toolbar))return;
      if(e.composedPath().some(n=>n?.matches?.('[data-znote-overlay]')))return this.hideToolbar();
      const t=globalThis.ZNoteImageTarget(e);
      if(!t||!globalThis.ZNoteWorkLocation?.(t))return this.hideToolbar();
      this.target=t;this.place();
    },true);
    document.addEventListener('focusin',e=>{if(!e.isTrusted||!this.enabled||root.contains(e.target))return;const t=e.target.matches?.('img')?e.target:e.target.querySelector?.('img');if(t&&globalThis.ZNoteWorkLocation?.(t)){this.target=t;this.describe();}});
    this.toolbar.addEventListener('pointerleave',()=>this.hideToolbar());
    window.addEventListener('scroll',()=>this.hideToolbar(),{passive:true});window.addEventListener('resize',()=>this.hideToolbar());
    for(const name of ['popstate','hashchange','pageshow','znote-page-changed'])window.addEventListener(name,()=>this.checkRoute());
    document.addEventListener('keydown',e=>{if(e.isTrusted&&e.key==='Escape'){this.hideToolbar();if(!gallery.panel.hidden)gallery.minimize();}});
    let timer;const observer=new MutationObserver(changes=>{
      if(!this.enabled)return;
      const relevant=changes.some(m=>!m.target.closest?.('[data-znote-overlay]')&&(m.target.closest?.('main')||[...m.addedNodes,...m.removedNodes].some(n=>n.nodeType===1&&(n.matches('main')||n.querySelector('main')))));
      if(!relevant)return;this.checkRoute();clearTimeout(timer);timer=setTimeout(()=>{this.describe();window.dispatchEvent(new Event('znote-work-updated'));},180);
    });observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['src','href','data-src','data-original']});
    this.describe();
  }
  hideToolbar(){this.toolbar.hidden=true;}
  setEnabled(value){this.enabled=value;if(!value){this.hideToolbar();this.gallery.panel.hidden=true;this.gallery.badge.hidden=true;}else if(this.gallery.panel.hidden)this.gallery.badge.hidden=false;}
  checkRoute(){if(this.route===location.href)return;this.route=location.href;this.generation++;this.target=null;this.hideToolbar();this.status.textContent='';this.describe();window.dispatchEvent(new Event('znote-page-changed'));}
  current(){return this.target?.isConnected&&globalThis.ZNoteWorkLocation?.(this.target)?this.target:[...document.querySelectorAll('main figure img,main a.fileThumb img')].find(t=>globalThis.ZNoteWorkLocation?.(t));}
  describe(){if(this.busy)return;const t=this.current(),url=t&&globalThis.ZNoteWorkLocation?.(t);this.title.textContent=url?(t.closest('.post-card--preview')?.querySelector('h1,h2,h3,.post-card__heading')?.textContent||document.querySelector('main h1')?.textContent||'当前作品'):'请选择作品';this.status.textContent=url?'':'悬停作品封面，或打开作品详情页';}
  place(){if(!this.target)return;const r=this.target.getBoundingClientRect();this.toolbar.hidden=false;const w=this.toolbar.offsetWidth,h=this.toolbar.offsetHeight;this.toolbar.style.left=Math.max(8,Math.min(innerWidth-w-8,r.right-w))+'px';this.toolbar.style.top=Math.max(8,Math.min(innerHeight-h-8,r.top+6))+'px';}
  async run(mode){
    if(!this.enabled||this.busy)return;this.checkRoute();const target=this.current();if(!target){this.gallery.show();this.describe();return;}
    const generation=this.generation,url=location.href;this.busy=true;this.buttons.forEach(b=>b.disabled=true);this.status.textContent='正在识别当前套图…';
    try{
      const group=await globalThis.ZNoteWorkImages(target);
      if(!this.enabled||generation!==this.generation||url!==location.href)throw Error('页面已切换，请对当前作品重新操作');
      if(!group?.images?.length)throw Error('作品图片尚未加载完成，请稍后重新识别');
      this.title.textContent=group.title;
      window.dispatchEvent(new Event('znote-hide-preview'));
      if(mode==='single-save'||group.images.length===1){const index=group.start_index||0;const resource=await this.send({type:'hover-resource',url:group.images[index],title:group.title+' · '+(index+1),source_url:group.source_url});const result=await this.send({type:'media-action',id:resource.id,action:mode==='download'?'download':'save'});this.status.textContent=result.message;this.gallery.show();}
      else{const result=await this.send({type:'media-gallery',group,action:mode,inline:true});this.status.textContent='';this.gallery.open(result.id);}
      this.hideToolbar();
    }catch(e){this.status.textContent=e.message;this.gallery.show();}
    finally{this.busy=false;this.buttons.forEach(b=>b.disabled=false);}
  }
};
