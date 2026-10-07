(() => {
  if (window.top !== window) return;
  let cancelCurrent;
  const clamp=(n,max)=>Math.max(0,Math.min(max,n));
  function select(reply) {
    cancelCurrent?.();
    document.getElementById('znote-region-result')?.remove();
    const host=document.createElement('div');host.setAttribute('data-znote-overlay','');host.id='znote-region-capture';
    host.style.cssText='position:fixed!important;inset:0!important;z-index:2147483647!important;touch-action:none!important;cursor:crosshair!important;';
    const shadow=host.attachShadow({mode:'open'});
    shadow.innerHTML=`<style>:host{all:initial}*{box-sizing:border-box}.screen{position:absolute;inset:0;background:#0005;touch-action:none}.box{position:absolute;border:2px solid #79bdab;box-shadow:0 0 0 9999px #0006;pointer-events:none}.bar{position:absolute;top:16px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:8px;max-width:calc(100vw - 16px);padding:10px;border:1px solid #648e87;border-radius:14px;background:#172b29;color:#fbf8ed;box-shadow:0 8px 28px #0005;font:13px/1.4 system-ui;cursor:default}.bar span{min-width:0}.bar button{flex-shrink:0;min-height:36px;padding:6px 12px;border:1px solid #648e87;border-radius:9px;background:#254d45;color:#fbf8ed;font:inherit;cursor:pointer}.bar button:disabled{opacity:.45;cursor:default}.bar button:focus-visible{outline:2px solid #fbf8ed}.help{position:absolute;top:78px;right:16px;max-width:min(320px,calc(100vw - 32px));max-height:50vh;overflow:auto;background:#172b29;color:#fbf8ed;padding:14px;border:1px solid #648e87;border-radius:12px;font:13px/1.6 system-ui}[hidden]{display:none!important}</style><div class="screen"></div><div class="box" hidden></div><div class="bar" role="toolbar" aria-label="框选截图"><span role="status">拖动框选截图区域</span><button class="help-button" aria-label="框选截图说明" aria-expanded="false">?</button><button class="cancel">取消</button><button class="confirm" disabled>保存截图</button></div><div class="help" role="tooltip" hidden>在页面上拖动鼠标或手指框选，松开后可重新拖动调整。确认后只保存选中区域。按 Enter 保存，Esc 或取消退出；截图保留页面来源。</div>`;
    document.documentElement.append(host);
    const screen=shadow.querySelector('.screen'),box=shadow.querySelector('.box'),bar=shadow.querySelector('.bar'),status=shadow.querySelector('[role="status"]'),confirm=shadow.querySelector('.confirm'),help=shadow.querySelector('.help'),helpButton=shadow.querySelector('.help-button');
    let start, region, closed=false;
    const dimensions={viewportWidth:innerWidth,viewportHeight:innerHeight};
    function cleanup(){host.remove();window.removeEventListener('resize',cancel);window.removeEventListener('pagehide',cancel);window.removeEventListener('keydown',keys,true);if(cancelCurrent===cancel)cancelCurrent=null;}
    function cancel(){if(closed)return;closed=true;cleanup();reply({cancelled:true});}
    function save(){if(closed||!region||confirm.disabled)return;closed=true;const source_url=location.href;cleanup();requestAnimationFrame(()=>requestAnimationFrame(()=>reply({region:{...region,...dimensions},source_url})));}
    function keys(event){if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();cancel();}if(event.key==='Enter'&&!helpButton.matches(':focus')){event.preventDefault();event.stopImmediatePropagation();save();}}
    const point=e=>({x:clamp(e.clientX,innerWidth),y:clamp(e.clientY,innerHeight)});
    screen.addEventListener('pointerdown',e=>{if(e.button!==0)return;e.preventDefault();e.stopPropagation();start=point(e);region=null;box.hidden=false;Object.assign(box.style,{left:start.x+'px',top:start.y+'px',width:'0px',height:'0px'});confirm.disabled=true;screen.setPointerCapture(e.pointerId);help.hidden=true;helpButton.setAttribute('aria-expanded','false');});
    screen.addEventListener('pointermove',e=>{if(!start)return;e.preventDefault();const end=point(e);region={x:Math.min(start.x,end.x),y:Math.min(start.y,end.y),width:Math.abs(end.x-start.x),height:Math.abs(end.y-start.y)};Object.assign(box.style,{left:region.x+'px',top:region.y+'px',width:region.width+'px',height:region.height+'px'});screen.style.background='transparent';status.textContent=`${Math.round(region.width)} × ${Math.round(region.height)}`;});
    screen.addEventListener('pointerup',e=>{if(!start)return;e.preventDefault();start=null;confirm.disabled=!region||region.width<8||region.height<8;status.textContent=confirm.disabled?'区域太小，请重新框选':`${Math.round(region.width)} × ${Math.round(region.height)}`;});
    screen.addEventListener('pointercancel',()=>{start=null;region=null;box.hidden=true;confirm.disabled=true;status.textContent='请重新框选';});
    screen.addEventListener('contextmenu',e=>{e.preventDefault();cancel();});
    bar.addEventListener('pointerdown',e=>e.stopPropagation());shadow.querySelector('.cancel').onclick=cancel;confirm.onclick=save;
    // Some touch browsers suppress the compatibility click after a prevented
    // selection gesture. Handle release directly; save/cancel are idempotent.
    confirm.addEventListener('pointerup',e=>{if(e.pointerType==='touch'){e.preventDefault();save();}});
    shadow.querySelector('.cancel').addEventListener('pointerup',e=>{if(e.pointerType==='touch'){e.preventDefault();cancel();}});
    let helpPinned=false,lastHelpTouch=0,helpPointerType='mouse';
    const showHelp=()=>{help.hidden=false;helpButton.setAttribute('aria-expanded','true');};
    const hideHelp=()=>{help.hidden=true;helpButton.setAttribute('aria-expanded','false');};
    const toggleHelp=()=>{helpPinned=!helpPinned;if(helpPinned)showHelp();else hideHelp();};
    helpButton.onclick=()=>{if(Date.now()-lastHelpTouch>700)toggleHelp();};
    helpButton.addEventListener('pointerdown',e=>{helpPointerType=e.pointerType;});
    helpButton.addEventListener('pointerup',e=>{if(e.pointerType==='touch'){e.preventDefault();lastHelpTouch=Date.now();toggleHelp();}});
    helpButton.addEventListener('pointerenter',e=>{if(e.pointerType==='mouse'&&Date.now()-lastHelpTouch>700)showHelp();});
    helpButton.addEventListener('pointerleave',e=>{if(e.pointerType==='mouse'&&!helpPinned)hideHelp();});
    helpButton.addEventListener('focus',()=>{if(helpPointerType!=='touch')showHelp();});
    helpButton.addEventListener('blur',()=>{if(!helpPinned)hideHelp();});
    window.addEventListener('keydown',keys,true);window.addEventListener('resize',cancel);window.addEventListener('pagehide',cancel);cancelCurrent=cancel;
  }
  chrome.runtime.onMessage.addListener((message,sender,reply)=>{
    if(sender.id!==chrome.runtime.id)return;
    if(message.type==='select-capture-region'){select(reply);return true;}
    if(message.type==='region-capture-result'){
      // Give the compositor an unobstructed frame before captureVisibleTab.
      if(message.message==='正在保存截图…')return;
      document.getElementById('znote-region-result')?.remove();const toast=document.createElement('div');toast.id='znote-region-result';toast.setAttribute('role','status');toast.textContent='ZNote：'+message.message;
      toast.style.cssText='position:fixed;right:16px;bottom:24px;z-index:2147483647;max-width:calc(100vw - 32px);padding:14px 18px;border:1px solid #648e87;border-radius:12px;background:#172b29;color:#fbf8ed;font:13px/1.5 system-ui;box-shadow:0 8px 28px #0005';document.documentElement.append(toast);setTimeout(()=>toast.remove(),6000);
    }
  });
})();
