/* Event-driven visibility gate shared by web, inbox and desktop. CSS owns frames. */
(() => {
  const root=document.documentElement,reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const selector='.library-card,.intro-banner,.signal-surface,.glitch-scene,.item-card,.dialog,.primary,.signal-button,.heading-actions > button:not(.icon-button)';
  const observed=new Set(),pulses=new Map();let enabled=false,queued=false;
  function shards(target,visible){
    const old=target.querySelector(':scope > .signal-shards');
    if(!visible){old?.remove();return;}
    if(old||!target.matches('.library-card,.intro-banner,.signal-surface,.primary,.signal-button'))return;
    const layer=document.createElement('span');layer.className='signal-shards';layer.setAttribute('aria-hidden','true');
    const compact=target.matches('.primary,.signal-button');let seed=47+Array.from(target.parentElement?.children||[]).indexOf(target)*71;
    const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
    for(let n=0;n<(compact?12:22);n++){
      const bit=document.createElement('i'),pixel=n%4===0;
      const x=n%3===0?random()*12:n%3===1?84+random()*14:20+random()*60;
      const properties={x:x+'%',y:Math.floor(random()*96)+'%',w:(pixel?2+Math.floor(random()*4):(compact?12:25)+Math.floor(random()*(compact?28:90)))+'px',h:(pixel?2+Math.floor(random()*3):1+Math.floor(random()*5))+'px',dx:Math.round((random()-.5)*(compact?85:180))+'px',dy:Math.round(-4-random()*24)+'px',sample:Math.round(random()*100)+'%'};
      for(const [key,value]of Object.entries(properties))bit.style.setProperty('--bit-'+key,value);
      layer.append(bit);
    }
    target.append(layer);
  }
  const intersection=typeof IntersectionObserver==='function'?new IntersectionObserver(entries=>{
    for(const {target,isIntersecting} of entries){const active=enabled&&isIntersecting;target.toggleAttribute('data-glitch-visible',active);shards(target,active);}
  }):null;
  function scan(){
    queued=false;if(!enabled)return;
    for(const el of observed)if(!el.isConnected){intersection?.unobserve(el);observed.delete(el);}
    for(const el of document.querySelectorAll(selector))if(!observed.has(el)){
      observed.add(el);if(intersection)intersection.observe(el);else{el.setAttribute('data-glitch-visible','');shards(el,true);}
    }
  }
  const children=new MutationObserver(()=>{if(!queued){queued=true;queueMicrotask(scan);}});
  function configure(){
    const running=root.dataset.style==='glitch'&&root.dataset.motion!=='still'&&!reduced.matches&&!document.hidden;
    root.dataset.glitchMotion=running?'running':'still';
    if(running===enabled)return;enabled=running;
    if(enabled){children.observe(document,{subtree:true,childList:true});scan();}
    else{children.disconnect();intersection?.disconnect();for(const el of observed){el.removeAttribute('data-glitch-visible');el.removeAttribute('data-glitch-pulse');shards(el,false);}observed.clear();for(const timer of pulses.values())clearTimeout(timer);pulses.clear();}
  }
  function pulse(event){
    if(!enabled||event.type==='keydown'&&!['Enter',' '].includes(event.key))return;
    const target=event.target instanceof Element?event.target.closest('button'):null;
    if(!target||!target.matches(selector)||target.disabled)return;
    clearTimeout(pulses.get(target));target.setAttribute('data-glitch-pulse','');
    pulses.set(target,setTimeout(()=>{target.removeAttribute('data-glitch-pulse');pulses.delete(target);},420));
  }
  new MutationObserver(configure).observe(root,{attributes:true,attributeFilter:['data-style','data-motion']});
  document.addEventListener('visibilitychange',configure);reduced.addEventListener('change',configure);
  document.addEventListener('pointerdown',pulse,{passive:true});document.addEventListener('keydown',pulse);
  configure();
})();
