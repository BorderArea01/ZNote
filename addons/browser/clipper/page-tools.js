// One owner for page actions and their feedback. No credentials or network API.
(() => {
  if (window !== top || !/^https?:$/.test(location.protocol) || globalThis.ZNotePageTools) return;
  let host, root, bar, actions, feedback, text, close, timer, owner, menu, more, progress, position, closeMenu, suspended=false, allowed=false;
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
    bar=document.createElement('section');bar.className='tools';bar.setAttribute('aria-label','ZNote 页面采集工具');bar.hidden=true;
    style.textContent+=`.actions [data-tool]{min-width:0;overflow:hidden;text-overflow:ellipsis}.actions [data-tool="video"]{flex:0 1 auto}.actions [data-tool="work"]{background:#345c43!important}.menu{max-height:calc(100dvh - 160px);overflow:auto;overscroll-behavior:contain}.menu .help{position:fixed;width:min(300px,calc(100vw - 16px));margin:0;padding:14px;border:1px solid #466052;border-radius:12px;background:#18251f;box-shadow:0 6px 24px #0005}`;
    actions=document.createElement('div');actions.className='actions';feedback=document.createElement('div');feedback.className='feedback';feedback.hidden=true;feedback.setAttribute('role','status');
    text=document.createElement('span');close=document.createElement('button');close.type='button';close.textContent='×';close.setAttribute('aria-label','关闭采集提示');close.onclick=()=>{if(!progress.hidden)dismissed.add(owner);clear();};
    progress=document.createElement('progress');progress.className='progress';progress.setAttribute('aria-label','采集进度');progress.hidden=true;
    feedback.append(text,close,progress);menu=document.createElement('div');menu.className='menu';menu.hidden=true;
    bar.append(actions,menu,feedback);root.append(style,bar);document.documentElement.append(host);
    const drag=document.createElement('button');drag.type='button';drag.className='drag';drag.textContent='⠿';drag.setAttribute('aria-label','拖动采集工具栏');drag.title='拖动移动；方向键微调';actions.append(drag);
    more=document.createElement('button');more.type='button';more.className='more';more.textContent='⋯';more.setAttribute('aria-label','更多采集方式');more.setAttribute('aria-expanded','false');actions.append(more);
    more.onclick=e=>{if(!e.isTrusted)return;if(!menu.hidden){closeMenu();return;}menu.hidden=false;more.setAttribute('aria-expanded','true');connect();};
    menu.innerHTML='<div class="menu-heading"><label for="znote-tools-destination">目标知识库</label></div><select id="znote-tools-destination" aria-label="目标知识库"><option value="">正在读取…</option></select><div class="grid"></div><p class="help" role="tooltip" hidden></p>';
    style.textContent+=`.menu-heading{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px}.menu .help-button{border-radius:50%;width:26px;min-height:26px;padding:0}.menu .link-toggle{width:100%;margin-top:8px}.link-form{display:grid;gap:6px;margin-top:8px}.link-form textarea{width:100%;min-height:72px;resize:vertical;border:1px solid #466052;border-radius:8px;background:#213129;color:#e9f2ed;padding:8px;font:12px/1.5 system-ui}.progress{appearance:none}.progress::-webkit-progress-bar{background:#304b3a;border-radius:3px}.progress::-webkit-progress-value{background:#91c4a2;border-radius:3px}`;
    const destination=menu.querySelector('select');destination.disabled=true;
    async function connect(){destination.disabled=true;try{const {value}=await request('media-connect');destination.replaceChildren(new Option('未分类',''),...value.collections.map(c=>new Option(c.name,c.id)));if(value.collection_id&&!value.collections.some(c=>c.id===value.collection_id))throw Error('目标知识库已删除，请在扩展设置中重新选择');destination.value=value.collection_id||'';destination.disabled=false;}catch(e){notice(e.message,{error:true,key:'tools'});}}
    destination.onchange=async()=>{destination.disabled=true;try{await request('media-destination',{collection_id:destination.value});}catch(e){notice(e.message,{error:true,key:'tools'});}finally{await connect();}};
    const grid=menu.querySelector('.grid');
    for(const [label,action] of [['框选截图','region'],['可见页面截图','screenshot'],['保存页面正文','article'],['解析作品视频','video'],['前往知识库','library'],['扩展设置','settings']]){
      const button=document.createElement('button');button.type='button';button.textContent=label;grid.append(button);
      button.onclick=async e=>{if(!e.isTrusted)return;closeMenu();root.dispatchEvent(new CustomEvent('tools-close'));button.disabled=true;try{
        if(action==='region'){await request('page-tools-action',{action});return;}
        if(action==='screenshot'){globalThis.ZNotePageTools.suspend(true);await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));}
        else if(action==='video')globalThis.ZNotePageTools.progress('正在提交视频解析…',{key:'work'});
        const result=await request('page-tools-action',{action});
        if(result.job)await track(result.job,'imports');
        else if(action==='screenshot')notice('页面截图已保存到知识库',{key:'tools'});
      }catch(e){notice(e.message,{error:true,key:'work'});}finally{button.disabled=false;if(action==='screenshot')globalThis.ZNotePageTools.suspend(false);}};
    }
    const linkToggle=document.createElement('button');linkToggle.type='button';linkToggle.className='link-toggle';linkToggle.textContent='粘贴作品链接';linkToggle.setAttribute('aria-expanded','false');menu.append(linkToggle);
    const linkForm=document.createElement('form');linkForm.className='link-form';linkForm.hidden=true;linkForm.innerHTML='<textarea aria-label="作品链接或分享文字" placeholder="粘贴链接或整段分享文字"></textarea><button type="submit">采集链接中的作品</button>';menu.append(linkForm);
    linkToggle.onclick=()=>{linkForm.hidden=!linkForm.hidden;linkToggle.setAttribute('aria-expanded',String(!linkForm.hidden));if(!linkForm.hidden)linkForm.querySelector('textarea').focus();};
    linkForm.onsubmit=async e=>{e.preventDefault();if(!e.isTrusted)return;const input=linkForm.querySelector('textarea'),button=linkForm.querySelector('button');if(!input.value.trim()){input.focus();return;}button.disabled=true;closeMenu();try{dismissed.delete('work');globalThis.ZNotePageTools.progress('正在提交作品链接…',{key:'work'});const result=await request('page-tools-action',{action:'link',text:input.value});await track(result.job);}catch(error){notice(error.message,{error:true,key:'work'});}finally{button.disabled=false;}};
    const hint=document.createElement('button');hint.type='button';hint.className='help-button';hint.textContent='?';hint.setAttribute('aria-label','页面采集说明');hint.setAttribute('aria-expanded','false');menu.querySelector('.menu-heading').append(hint);
    const help=menu.querySelector('.help');help.textContent='采集当前作品支持 X、小红书、B 站及能公开读取的图集和网页；需要登录的作品可用页面正文或媒体嗅探。框选截图：拖动选择，Enter 保存、Esc 取消。拖住左侧把手移动工具栏，方向键微调；位置自动记住。进度显示服务器实际阶段和数量，不估算下载百分比。';
    let pinned=false;const show=()=>{help.hidden=false;hint.setAttribute('aria-expanded','true');const a=hint.getBoundingClientRect(),b=help.getBoundingClientRect();help.style.left=Math.max(8,Math.min(a.left,innerWidth-b.width-8))+'px';help.style.top=Math.max(8,Math.min(a.top>b.height+16?a.top-b.height-8:a.bottom+8,innerHeight-b.height-8))+'px';},hide=()=>{help.hidden=true;hint.setAttribute('aria-expanded','false');};
    hint.onclick=()=>{pinned=!pinned;pinned?show():hide();};hint.onpointerenter=e=>{if(e.pointerType==='mouse')show();};hint.onpointerleave=e=>{if(e.pointerType==='mouse'&&!pinned)hide();};hint.onfocus=show;hint.onblur=()=>{if(!pinned)hide();};
    closeMenu=()=>{menu.hidden=true;more.setAttribute('aria-expanded','false');pinned=false;hide();};
    document.addEventListener('pointerdown',e=>{if(!e.composedPath().includes(host))closeMenu();},true);
    let dragging;
    drag.onpointerdown=e=>{if(e.button!==0)return;e.preventDefault();const b=host.getBoundingClientRect();dragging={x:e.clientX,y:e.clientY,left:b.left,top:b.top};drag.setPointerCapture(e.pointerId);};
    drag.onpointermove=e=>{if(!dragging)return;e.preventDefault();place({x:dragging.left+e.clientX-dragging.x,y:dragging.top+e.clientY-dragging.y});};
    const finish=()=>{if(!dragging)return;dragging=null;persistPosition();};drag.onpointerup=finish;drag.onpointercancel=finish;
    drag.onkeydown=e=>{const delta={ArrowLeft:[-12,0],ArrowRight:[12,0],ArrowUp:[0,-12],ArrowDown:[0,12]}[e.key];if(!delta)return;e.preventDefault();const b=host.getBoundingClientRect();place({x:b.left+delta[0],y:b.top+delta[1]});persistPosition();};
    new MutationObserver(refresh).observe(actions,{childList:true,subtree:true,attributes:true,attributeFilter:['class','hidden']});
    new ResizeObserver(()=>{place();emitLayout();}).observe(bar);
    window.addEventListener('resize',()=>{place();emitLayout();});
    root.addEventListener('keydown',event=>{if(event.key==='Escape'){event.stopPropagation();clear();menu.hidden=true;more.setAttribute('aria-expanded','false');pinned=false;hide();root.dispatchEvent(new CustomEvent('tools-close'));}});
  }
  function emitLayout(){const b=host.getBoundingClientRect();for(const fn of layout)fn(b.height,b);}
  function place(next){
    if(next)position=next;if(!host||!position)return;
    // Temporary menu/progress growth may need more space. Preserve the chosen
    // anchor so collapsing the toolbar returns to the same place.
    const b=bar.getBoundingClientRect(),x=Math.max(8,Math.min(position.x,innerWidth-b.width-8)),y=Math.max(8,Math.min(position.y,innerHeight-b.height-8));
    host.style.setProperty('right','auto','important');host.style.setProperty('bottom','auto','important');host.style.setProperty('left',x+'px','important');host.style.setProperty('top',y+'px','important');emitLayout();
  }
  function persistPosition(){const b=host.getBoundingClientRect();position={x:b.left,y:b.top};request('page-tools-position',{position}).catch(e=>notice(e.message,{error:true,key:'tools'}));}
  function notice(message,{error=false,key='post',busy=false}={}){mount();if(busy&&dismissed.has(key))return;if(!busy)dismissed.delete(key);clearTimeout(timer);owner=key;text.textContent=message;feedback.dataset.error=String(error);feedback.hidden=false;progress.hidden=!busy;if(!busy)timer=setTimeout(()=>clear(key),error?20000:6000);}
  function clear(key) { if(!feedback || (key && key!==owner))return;clearTimeout(timer);feedback.hidden=true;owner=null; }
  async function track(job,kind='captures'){
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
  async function refreshSettings(){try{const {value}=await request('media-settings',{znotePage:!!document.querySelector('meta[name="znote-app"]')});allowed=!value.blocked&&value.dock!==false;mount();refresh();}catch{allowed=false;if(bar)refresh();}}
  function updateWork(){
    mount();const x=/^(?:www\.|mobile\.)?(?:x|twitter)\.com$/.test(location.hostname)&&/^\/[\w]+\/status\/\d+/.test(location.pathname);
    if(x){work?.remove();work=null;return;}
    if(work&&work.dataset.url!==location.href){work.remove();work=null;}
    if(!work){
      work=document.createElement('button');work.type='button';work.className='znote-work-button';work.dataset.url=location.href;work.setAttribute('aria-label','采集当前作品');globalThis.ZNotePageTools.register('work',work);
      work.onclick=async e=>{
        if(!e.isTrusted||e.currentTarget.disabled)return;
        const button=e.currentTarget;button.disabled=true;button.textContent='采集中…';closeMenu();
        try{dismissed.delete('work');globalThis.ZNotePageTools.progress('正在提交当前作品…',{key:'work'});const result=await request('page-tools-action',{action:'work'});await track(result.job);button.textContent='已保存 ✓';}
        catch(error){button.textContent='重试采集';notice(error.message,{error:true,key:'work'});}
        finally{button.disabled=false;}
      };
    }
    if(!work.disabled)work.textContent='ZNote · 采集当前作品';
  }
  chrome.runtime.onMessage.addListener(message=>{if(message.type==='media-settings-changed')refreshSettings();if(message.type==='media-page-changed'){updateWork();if(!work?.disabled)clear('work');}});
  mount();request('page-tools-position').then(result=>{if(result.position)place(result.position);}).catch(()=>{});updateWork();refreshSettings();
  new MutationObserver(()=>{if(host&&!host.isConnected)mount();}).observe(document.documentElement,{childList:true});
})();
