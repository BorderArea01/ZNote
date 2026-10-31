// One owner for page actions and their feedback. No credentials or network API.
(() => {
  if (window !== top || !/^https?:$/.test(location.protocol) || globalThis.ZNotePageTools) return;
  let host, root, bar, actions, feedback, text, close, timer, owner, menu, more, progress, position, closeMenu, suspended=false, allowed=false, saveAction='save';
  let tab, compact=true, edge='right', idleTimer, hoverTimer, dragging, suppressTabClick=false, pointerInside=false, hoverSuppressed=false;
  const layout=new Set();
  const dismissed=new Set();
  const refresh = () => { bar.hidden = !allowed || suspended; };
  async function request(type,extra={}) {
    for(let attempt=0;attempt<2;attempt++){
      let result;
      try{result=await chrome.runtime.sendMessage({type,...extra});}
      catch(error){throw Error(/context invalidated|receiving end|message port|channel closed/i.test(error.message||'')?'扩展连接已失效，请重新加载扩展并刷新网页':error.message);}
      if(result){if(!result.ok)throw Error(result.error||'操作失败，请重试');return result;}
      if(!attempt)await new Promise(resolve=>setTimeout(resolve,250));
    }
    throw Error('扩展后台未响应，请重新加载扩展并刷新网页');
  }
  function mount() {
    if (host) {if(!host.isConnected)document.documentElement.append(host);return;}
    host = document.createElement('div'); host.dataset.znotePageTools = 'true';
    host.style.cssText = "all:initial!important;font:13px/1.5 system-ui,'Microsoft YaHei',sans-serif!important;color:#e9f2ed!important;position:fixed!important;right:18px!important;bottom:24px!important;z-index:2147483647!important;max-width:calc(100vw - 36px)!important;pointer-events:none!important";
    root = host.attachShadow({mode:'open'});
    const style = document.createElement('style');
    style.textContent = `:host{font:13px/1.5 system-ui,'Microsoft YaHei',sans-serif;color:#e9f2ed}*{box-sizing:border-box}[hidden],.hidden{display:none!important}.tools{max-width:min(340px,calc(100vw - 36px));border:1px solid #466052;border-radius:16px;background:#18251f;box-shadow:0 6px 24px #0005;pointer-events:auto;overflow:hidden}.actions{display:flex;align-items:stretch;padding:4px;gap:4px}.actions button{position:static!important;flex:1;min-height:38px;margin:0!important;border:0!important;border-radius:11px!important;background:transparent!important;color:#d5e4db!important;padding:8px 12px!important;font:600 12px/1.5 system-ui!important;cursor:pointer;box-shadow:none!important;white-space:nowrap}.actions button:hover{background:#304b3a!important}.actions button:focus-visible,.feedback button:focus-visible{outline:2px solid #9bc8ac;outline-offset:-3px}.actions button:disabled{opacity:.65;cursor:progress}.actions .znote-x-post-button{background:#345c43!important;color:#f0f7f2!important}.actions:has(.znote-x-post-button) .dock{border-left:1px solid #466052!important;border-radius:0 11px 11px 0!important;padding:8px 10px!important}.feedback{display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border-top:1px solid #3a5143;color:#c2d8cb;font-size:12px;line-height:1.6;overflow-wrap:anywhere;max-height:min(45vh,240px);overflow:auto;overscroll-behavior:contain}.feedback[data-error=true]{color:#efc6a0}.feedback span{flex:1;min-width:0}.feedback button{flex-shrink:0;background:none;border:0;color:inherit;font:20px/1 system-ui;cursor:pointer;width:28px;height:28px;border-radius:6px}`;
    style.textContent+=`.tools{overflow:visible}.actions{align-items:center}.actions .drag{flex:0 0 24px;padding:6px 2px!important;cursor:grab;touch-action:none;font-size:18px!important;color:#8ca896!important}.actions .more{flex:0 0 34px;padding:6px!important}.menu{padding:12px;border-top:1px solid #3a5143}.menu label{display:grid;gap:6px;font-size:12px;color:#a8c2b1}.menu select{width:100%;min-height:38px;background:#21372a;border:1px solid #466052;border-radius:9px;color:#e9f2ed;padding:6px;font:inherit}.menu .grid{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:10px}.menu button{font:12px/1.5 system-ui;color:#d5e4db;border:1px solid #3a5143;background:#213129;border-radius:9px;min-height:38px;padding:8px;cursor:pointer}.menu button:hover{background:#304b3a}.menu button:focus-visible{outline:2px solid #9bc8ac}.menu .help{max-height:35vh;overflow:auto;overscroll-behavior:contain;margin:10px 0 0;color:#b7cebf;font-size:12px;line-height:1.7}.feedback{flex-wrap:wrap}.progress{width:100%;height:3px;border:0;accent-color:#91c4a2}.actions button{padding:8px!important}.tools:has(.menu:not([hidden])){width:300px}.feedback span{white-space:pre-line}@media(prefers-reduced-motion:no-preference){.progress:indeterminate{opacity:.65}}`;
    style.textContent+=`.edge-tab{display:none;position:relative;width:100%;height:46px;padding:0;border:0;background:transparent;color:#e0e4e2;cursor:pointer;touch-action:none;font:italic 700 15px/1 system-ui}.edge-tab .dot{position:absolute;bottom:7px;left:10px;width:4px;height:4px;border-radius:50%;background:#c7cfcb;opacity:0}.edge-tab[data-state=busy] .dot,.edge-tab[data-state=done] .dot,.edge-tab[data-state=error] .dot{opacity:1}.edge-tab[data-state=error] .dot{background:#edb181}.edge-tab:focus-visible{outline:2px solid #becfc4;outline-offset:-4px}.tools[data-compact=true]{width:24px;max-width:24px;border-radius:12px 0 0 12px;border-right:0;background:#202824eb;box-shadow:0 2px 12px #0003}.tools[data-edge=left][data-compact=true]{border-radius:0 12px 12px 0;border-left:0;border-right:1px solid #466052}.tools[data-compact=true]>.actions,.tools[data-compact=true]>.menu,.tools[data-compact=true]>.feedback{display:none!important}.tools[data-compact=true]>.edge-tab{display:block}.tools[data-dragging=true][data-compact=true]{border-radius:12px;border:1px solid #466052}.actions .minimize{flex:0 0 28px;padding:6px!important;font-size:16px!important}.dock-announcement{position:absolute;width:1px;height:1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap}@media(prefers-reduced-motion:no-preference){.edge-tab[data-state=busy] .dot{animation:znote-dock-pulse 1.2s ease-in-out infinite}@keyframes znote-dock-pulse{50%{opacity:.35}}}`;
    bar=document.createElement('section');bar.className='tools';bar.dataset.compact='true';bar.dataset.edge=edge;bar.setAttribute('aria-label','ZNote 页面采集工具');bar.hidden=true;
    // Keep the small gap between an expanded bar and the screen edge inside
    // the hover region, so opening under a stationary mouse cannot lose hover.
    style.textContent+=`.tools[data-compact=false]::after{content:'';position:absolute;top:0;bottom:0;width:9px;pointer-events:auto}.tools[data-compact=false][data-edge=right]::after{right:-9px}.tools[data-compact=false][data-edge=left]::after{left:-9px}.tools[data-edge=free]::after{display:none}`;
    style.textContent+=`.actions [data-tool]{min-width:0;overflow:hidden;text-overflow:ellipsis}.actions [data-tool="video"]{flex:0 1 auto}.actions [data-tool="work"]{background:#345c43!important}.menu{max-height:calc(100dvh - 160px);overflow:auto;overscroll-behavior:contain}.menu .help{position:fixed;width:min(300px,calc(100vw - 16px));margin:0;padding:14px;border:1px solid #466052;border-radius:12px;background:#18251f;box-shadow:0 6px 24px #0005}`;
    actions=document.createElement('div');actions.className='actions';feedback=document.createElement('div');feedback.className='feedback';feedback.hidden=true;feedback.setAttribute('role','status');
    text=document.createElement('span');close=document.createElement('button');close.type='button';close.textContent='×';close.setAttribute('aria-label','关闭采集提示');close.onclick=()=>{if(!progress.hidden)dismissed.add(owner);clear();};
    progress=document.createElement('progress');progress.className='progress';progress.setAttribute('aria-label','采集进度');progress.hidden=true;
    feedback.append(text,close,progress);menu=document.createElement('div');menu.className='menu';menu.hidden=true;
    tab=document.createElement('button');tab.type='button';tab.className='edge-tab';tab.innerHTML='<span aria-hidden="true">Z</span><span class="dot" aria-hidden="true"></span>';tab.setAttribute('aria-label','展开 ZNote 采集工具');tab.setAttribute('aria-expanded','false');tab.title='ZNote · 鼠标掠过或点击展开，拖动调整位置';
    const announcement=document.createElement('span');announcement.className='dock-announcement';announcement.setAttribute('aria-live','polite');
    bar.append(tab,actions,menu,feedback,announcement);root.append(style,bar);document.documentElement.append(host);
    const drag=document.createElement('button');drag.type='button';drag.className='drag';drag.textContent='⠿';drag.setAttribute('aria-label','拖动采集工具栏');drag.title='拖动移动；方向键微调';actions.append(drag);
    more=document.createElement('button');more.type='button';more.className='more';more.textContent='⋯';more.setAttribute('aria-label','更多采集方式');more.setAttribute('aria-expanded','false');actions.append(more);
    more.onclick=e=>{if(!e.isTrusted)return;if(!menu.hidden){closeMenu();return;}menu.hidden=false;more.setAttribute('aria-expanded','true');connect();};
    const minimize=document.createElement('button');minimize.type='button';minimize.className='minimize';minimize.textContent='›';minimize.setAttribute('aria-label','收起并靠边');minimize.title='收起并靠边';minimize.onclick=()=>collapse(true);actions.append(minimize);
    tab.onclick=e=>{if(!e.isTrusted||suppressTabClick){suppressTabClick=false;return;}expand();if(e.detail===0)actions.querySelector('[data-tool]:not(:disabled)')?.focus();};
    menu.innerHTML='<div class="menu-heading"><label for="znote-tools-destination">目标知识库</label></div><select id="znote-tools-destination" aria-label="目标知识库"><option value="">正在读取…</option></select><div class="grid"></div><p class="help" role="tooltip" hidden></p>';
    style.textContent+=`.menu-heading{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px}.menu .help-button{border-radius:50%;width:26px;min-height:26px;padding:0}.menu .link-toggle{width:100%;margin-top:8px}.link-form{display:grid;gap:6px;margin-top:8px}.link-form textarea{width:100%;min-height:72px;resize:vertical;border:1px solid #466052;border-radius:8px;background:#213129;color:#e9f2ed;padding:8px;font:12px/1.5 system-ui}.progress{appearance:none}.progress::-webkit-progress-bar{background:#304b3a;border-radius:3px}.progress::-webkit-progress-value{background:#91c4a2;border-radius:3px}`;
    const destination=menu.querySelector('select');destination.disabled=true;
    async function connect(){if(saveAction==='download')return;destination.disabled=true;try{const {value}=await request('media-connect');destination.replaceChildren(new Option('未分类',''),...value.collections.map(c=>new Option(c.name,c.id)));if(value.collection_id&&!value.collections.some(c=>c.id===value.collection_id))throw Error('目标知识库已删除，请在扩展设置中重新选择');destination.value=value.collection_id||'';destination.disabled=false;}catch(e){notice(e.message,{error:true,key:'tools'});}}
    destination.onchange=async()=>{destination.disabled=true;try{await request('media-destination',{collection_id:destination.value});}catch(e){notice(e.message,{error:true,key:'tools'});}finally{await connect();}};
    const grid=menu.querySelector('.grid');
    for(const [label,action] of [['框选截图','region'],['可见页面截图','screenshot'],['保存页面正文','article'],['解析作品视频','video'],['前往知识库','library'],['扩展设置','settings']]){
      const button=document.createElement('button');button.type='button';button.textContent=label;button.dataset.action=action;grid.append(button);
      button.onclick=async e=>{if(!e.isTrusted)return;closeMenu();root.dispatchEvent(new CustomEvent('tools-close'));button.disabled=true;try{
        if(action==='region'){await request('page-tools-action',{action});return;}
        if(action==='screenshot'){globalThis.ZNotePageTools.suspend(true);await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));}
        else if(action==='video')globalThis.ZNotePageTools.progress('正在提交视频解析…',{key:'work'});
        const result=await request('page-tools-action',{action});
        if(result.job)await track(result.job,'imports');
        else if(action==='screenshot'){if(result.item?.kind==='download')await track(result.item);else notice('页面截图已保存到知识库',{key:'tools'});}
      }catch(e){notice(e.message,{error:true,key:'work'});}finally{button.disabled=false;if(action==='screenshot')globalThis.ZNotePageTools.suspend(false);}};
    }
    const linkToggle=document.createElement('button');linkToggle.type='button';linkToggle.className='link-toggle';linkToggle.textContent='粘贴作品链接';linkToggle.setAttribute('aria-expanded','false');menu.append(linkToggle);
    const linkForm=document.createElement('form');linkForm.className='link-form';linkForm.hidden=true;linkForm.innerHTML='<textarea aria-label="作品链接或分享文字" placeholder="粘贴链接或整段分享文字"></textarea><button type="submit">采集链接中的作品</button>';menu.append(linkForm);
    linkToggle.onclick=()=>{linkForm.hidden=!linkForm.hidden;linkToggle.setAttribute('aria-expanded',String(!linkForm.hidden));if(!linkForm.hidden)linkForm.querySelector('textarea').focus();};
    linkForm.onsubmit=async e=>{e.preventDefault();if(!e.isTrusted)return;const input=linkForm.querySelector('textarea'),button=linkForm.querySelector('button');if(!input.value.trim()){input.focus();return;}button.disabled=true;closeMenu();try{dismissed.delete('work');globalThis.ZNotePageTools.progress('正在提交作品链接…',{key:'work'});const result=await request('page-tools-action',{action:'link',text:input.value});await track(result.job);}catch(error){notice(error.message,{error:true,key:'work'});}finally{button.disabled=false;}};
    const hint=document.createElement('button');hint.type='button';hint.className='help-button';hint.textContent='?';hint.setAttribute('aria-label','页面采集说明');hint.setAttribute('aria-expanded','false');menu.querySelector('.menu-heading').append(hint);
    const help=menu.querySelector('.help');help.textContent='采集当前作品支持 X、小红书、B 站及能公开读取的图集和网页；需要登录的作品可用页面正文或媒体嗅探。框选截图：拖动选择，Enter 保存、Esc 取消。鼠标掠过边缘 Z 页签自动展开，也可点击展开；拖动页签或把手移动，靠边松手吸附收起；方向键微调，位置自动记住。移开鼠标后闲置四秒自动收起，菜单和视频面板使用中保持展开。采集中、完成或失败会在页签显示状态点，点击查看详情。进度显示服务器实际阶段和数量，不估算下载百分比。';
    let pinned=false;const show=()=>{help.hidden=false;hint.setAttribute('aria-expanded','true');const a=hint.getBoundingClientRect(),b=help.getBoundingClientRect();help.style.left=Math.max(8,Math.min(a.left,innerWidth-b.width-8))+'px';help.style.top=Math.max(8,Math.min(a.top>b.height+16?a.top-b.height-8:a.bottom+8,innerHeight-b.height-8))+'px';},hide=()=>{help.hidden=true;hint.setAttribute('aria-expanded','false');};
    hint.onclick=()=>{pinned=!pinned;pinned?show():hide();};hint.onpointerenter=e=>{if(e.pointerType==='mouse')show();};hint.onpointerleave=e=>{if(e.pointerType==='mouse'&&!pinned)hide();};hint.onfocus=show;hint.onblur=()=>{if(!pinned)hide();};
    closeMenu=()=>{menu.hidden=true;more.setAttribute('aria-expanded','false');pinned=false;hide();};
    document.addEventListener('pointerdown',e=>{if(!e.composedPath().includes(host))closeMenu();},true);
    for(const handle of [drag,tab]){
      handle.onpointerdown=e=>{if(!e.isTrusted||e.button!==0||dragging)return;clearTimeout(hoverTimer);hoverSuppressed=true;clearTimeout(idleTimer);if(handle===drag)e.preventDefault();const b=host.getBoundingClientRect();dragging={id:e.pointerId,x:e.clientX,y:e.clientY,left:b.left,top:b.top,moved:false,original:position&&{...position}};handle.setPointerCapture(e.pointerId);};
      handle.onpointermove=e=>{if(!dragging||e.pointerId!==dragging.id)return;if(!dragging.moved&&Math.hypot(e.clientX-dragging.x,e.clientY-dragging.y)<5)return;e.preventDefault();dragging.moved=true;bar.dataset.dragging='true';place({x:dragging.left+e.clientX-dragging.x,y:dragging.top+e.clientY-dragging.y});};
      const finish=e=>{
        if(!dragging||e.pointerId!==dragging.id)return;
        const previous=dragging;dragging=null;delete bar.dataset.dragging;
        // Touch capture can omit the compatibility click after a moved window.
        // Activate a stationary trusted touch on release; ignore its later click.
        if(!previous.moved&&e.type==='pointerup'&&e.pointerType==='touch'&&handle===tab){suppressTabClick=true;setTimeout(()=>suppressTabClick=false,250);expand();}
        if(previous.moved){
          suppressTabClick=handle===tab&&e.type!=='pointercancel';setTimeout(()=>suppressTabClick=false,250);
          if(e.type==='pointercancel'){position=previous.original;edge=position?.edge??null;place();}
          else{const b=host.getBoundingClientRect();position={x:b.left,y:b.top};edge=null;if(compact||b.left<48||innerWidth-b.right<48)collapse(false);else{place();persistPosition();}}
        }
        scheduleCollapse();
      };
      handle.onpointerup=finish;handle.onpointercancel=finish;handle.onlostpointercapture=finish;
      handle.onkeydown=e=>{const delta={ArrowLeft:[-12,0],ArrowRight:[12,0],ArrowUp:[0,-12],ArrowDown:[0,12]}[e.key];if(!delta)return;e.preventDefault();if(e.key==='ArrowLeft')edge=compact?'left':null;if(e.key==='ArrowRight')edge=compact?'right':null;const b=host.getBoundingClientRect();place({x:b.left+delta[0],y:b.top+delta[1],edge});persistPosition();};
    }
    bar.addEventListener('pointerenter',e=>{pointerInside=true;clearTimeout(idleTimer);if(e.isTrusted&&e.pointerType==='mouse'&&!e.buttons&&compact&&!hoverSuppressed){clearTimeout(hoverTimer);hoverTimer=setTimeout(()=>{if(pointerInside&&compact&&!dragging&&!hoverSuppressed&&allowed&&!suspended&&!bar.hidden)expand();},120);}});
    bar.addEventListener('pointerleave',()=>{pointerInside=false;clearTimeout(hoverTimer);if(!dragging)hoverSuppressed=false;scheduleCollapse()});
    bar.addEventListener('focusin',()=>clearTimeout(idleTimer));bar.addEventListener('focusout',()=>scheduleCollapse());bar.addEventListener('click',scheduleCollapse);
    new MutationObserver(refresh).observe(actions,{childList:true,subtree:true,attributes:true,attributeFilter:['class','hidden']});
    new ResizeObserver(()=>{place();emitLayout();}).observe(bar);
    window.addEventListener('resize',()=>{place();emitLayout();});
    root.addEventListener('keydown',event=>{if(event.key==='Escape'){event.stopPropagation();clear();closeMenu();root.dispatchEvent(new CustomEvent('tools-close'));collapse(true);}});
    place();
  }
  function scheduleCollapse(){clearTimeout(idleTimer);if(compact||dragging||suspended)return;idleTimer=setTimeout(()=>{const focused=root.activeElement,keyboardFocus=focused&&focused!==tab&&focused.matches(':focus-visible');if(!pointerInside&&menu.hidden&&!keyboardFocus&&!externalOpen())collapse(false);else scheduleCollapse();},4000);}
  function externalOpen(){const overlay=document.querySelector('[data-znote-overlay]');return !!overlay?.shadowRoot?.querySelector('.panel:not(.hidden):not([hidden]),.preview:not(.hidden):not([hidden])');}
  function expand(){compact=false;bar.dataset.compact='false';tab.setAttribute('aria-expanded','true');place();scheduleCollapse();}
  function collapse(focus){clearTimeout(idleTimer);clearTimeout(hoverTimer);hoverSuppressed=pointerInside;if(!host)return;const b=host.getBoundingClientRect();edge=edge||(b.left+b.width/2<innerWidth/2?'left':'right');position={x:b.left,y:position?.y??b.top,edge};closeMenu?.();root.dispatchEvent(new CustomEvent('tools-close'));compact=true;bar.dataset.compact='true';bar.dataset.edge=edge;tab.setAttribute('aria-expanded','false');place();persistPosition();if(focus)tab.focus();}
  function emitLayout(){const b=host.getBoundingClientRect();for(const fn of layout)fn(b.height,b);}
  function place(next){
    if(next){position=next;if(!dragging)edge=next.edge??null;}if(!host)return;if(!position)position={x:innerWidth,y:innerHeight-96,edge:'right'};
    // Temporary menu/progress growth may need more space. Preserve the chosen
    // anchor so collapsing the toolbar returns to the same place.
    const b=bar.getBoundingClientRect();if(compact&&!dragging&&!edge)edge=position.x+b.width/2<innerWidth/2?'left':'right';bar.dataset.edge=edge||'free';
    const x=dragging?.moved?Math.max(0,Math.min(position.x,innerWidth-b.width)):edge==='left'?(compact?0:8):edge==='right'?innerWidth-b.width-(compact?0:8):Math.max(8,Math.min(position.x,innerWidth-b.width-8)),y=Math.max(8,Math.min(position.y,innerHeight-b.height-8));
    host.style.setProperty('right','auto','important');host.style.setProperty('bottom','auto','important');host.style.setProperty('left',x+'px','important');host.style.setProperty('top',y+'px','important');emitLayout();
  }
  function persistPosition(){const b=host.getBoundingClientRect();position={x:b.left,y:b.top,edge};request('page-tools-position',{position}).catch(e=>notice(e.message,{error:true,key:'tools'}));}
  function notice(message,{error=false,key='post',busy=false}={}){mount();if(busy&&dismissed.has(key))return;if(!busy)dismissed.delete(key);clearTimeout(timer);owner=key;text.textContent=message;feedback.dataset.error=String(error);feedback.hidden=false;progress.hidden=!busy;tab.dataset.state=busy?'busy':error?'error':'done';tab.title='ZNote · '+message;tab.setAttribute('aria-label','展开 ZNote 采集工具：'+message);root.querySelector('.dock-announcement').textContent=message;if(!busy)timer=setTimeout(()=>{if(!compact)clear(key)},error?20000:6000);}
  function clear(key) { if(!feedback || (key && key!==owner))return;clearTimeout(timer);feedback.hidden=true;owner=null;delete tab.dataset.state;tab.title='ZNote · 鼠标掠过或点击展开，拖动调整位置';tab.setAttribute('aria-label','展开 ZNote 采集工具');root.querySelector('.dock-announcement').textContent=''; }
  async function track(job,kind='captures'){
    if(['download','media'].includes(job?.kind))kind=job.kind;
    const started=Date.now();
    while(['queued','running'].includes(job?.status)){
      globalThis.ZNotePageTools.progress(job.message||'等待服务器处理',{key:'work',elapsed:Math.floor((Date.now()-started)/1000)});
      await new Promise(resolve=>setTimeout(resolve,1000));job=(await request('page-tools-status',{id:job.id,kind})).job;
      if(!job?.status)throw Error('无法读取任务状态，可到知识库采集记录查看');
    }
    if(job?.status!=='completed')throw Error(job?.message||'未返回有效采集任务，请重试');notice(job.message||'已保存到知识库',{key:'work'});return job;
  }
  globalThis.ZNotePageTools = {
    register(key,node){mount();actions.querySelector(`[data-tool="${key}"]`)?.remove();node.dataset.tool=key;actions.insertBefore(node,key==='post'?actions.querySelector('.drag').nextSibling:more);refresh();return node;},
    notice,
    progress(message,{key='post',elapsed=0}={}){notice(`${message}${elapsed?' · 已用 '+elapsed+' 秒':''}`,{key,busy:true});const count=message.match(/(\d+)\/(\d+)/);if(count){progress.max=Number(count[2]);progress.value=Number(count[1]);}else progress.removeAttribute('value');},
    suspend(value){mount();suspended=value;if(value)root.dispatchEvent(new CustomEvent('tools-close'));refresh();},
    clear,
    get host(){return host;},
    onClose(fn){mount();root.addEventListener('tools-close',fn);},
    onLayout(fn){mount();layout.add(fn);emitLayout();},
  };
  let work;
  async function refreshSettings(){try{const {value}=await request('media-settings',{znotePage:!!document.querySelector('meta[name="znote-app"]')});allowed=!value.blocked&&value.dock!==false;saveAction=value.saveAction==='download'?'download':'save';mount();refreshMode();refresh();}catch{allowed=false;if(bar)refresh();}}
  function refreshMode(){
    const download=saveAction==='download';
    menu.querySelector('select').hidden=download;
    menu.querySelector('.menu-heading label').textContent=download?'下载到浏览器默认目录':'目标知识库';
    menu.querySelector('[data-action="article"]').textContent=download?'下载页面正文':'保存页面正文';
    menu.querySelector('.link-form button').textContent=download?'下载链接中的作品':'采集链接中的作品';
    if(work&&!work.disabled){work.textContent=download?'下载当前作品':'采集当前作品';work.setAttribute('aria-label',download?'下载当前作品':'采集当前作品');}
  }
  function updateWork(){
    mount();const x=/^(?:www\.|mobile\.)?(?:x|twitter)\.com$/.test(location.hostname)&&/^\/[\w]+\/status\/\d+/.test(location.pathname);
    if(x){work?.remove();work=null;return;}
    if(work&&work.dataset.url!==location.href){work.remove();work=null;}
    if(!work){
      work=document.createElement('button');work.type='button';work.className='znote-work-button';work.dataset.url=location.href;work.setAttribute('aria-label','采集当前作品');globalThis.ZNotePageTools.register('work',work);
      work.onclick=async e=>{
        if(!e.isTrusted||e.currentTarget.disabled)return;
        const button=e.currentTarget,mode=saveAction;button.disabled=true;button.textContent='采集中…';closeMenu();
        try{dismissed.delete('work');globalThis.ZNotePageTools.progress('正在提交当前作品…',{key:'work'});const result=await request('page-tools-action',{action:'work'});await track(result.job);button.textContent=result.job?.kind==='download'?'已下载 ✓':'已保存 ✓';}
        catch(error){button.textContent='重试采集';notice(error.message,{error:true,key:'work'});}
        finally{button.disabled=false;if(mode!==saveAction)refreshMode();}
      };
    }
    refreshMode();
  }
  chrome.runtime.onMessage.addListener(message=>{if(message.type==='media-settings-changed')refreshSettings();if(message.type==='media-page-changed'){updateWork();if(!work?.disabled)clear('work');}});
  mount();request('page-tools-position').then(result=>{if(result.position)place(result.position);}).catch(()=>{});updateWork();refreshSettings();
  new MutationObserver(()=>{if(host&&!host.isConnected)mount();}).observe(document.documentElement,{childList:true});
})();
