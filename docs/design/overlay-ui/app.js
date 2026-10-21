const plans=[
 {id:'bean',letter:'A',name:'磁吸豆',tag:'细把手 / 完整圆钮 / 轻量卡片',description:'保留熟悉的浮窗，收起时只露一粒细豆。拖离边缘恢复完整 Z 按钮，点击打开小卡片。',benefit:'最均衡',tradeoff:'边缘更安静，入口仍容易找到。',docked:'9 × 34',free:'40 × 40'},
 {id:'bookmark',letter:'B',name:'折页签',tag:'小页签 / 圆角方钮 / 书签卡片',description:'边缘留一枚短页签，像给当前页面夹了个书签。拖出后恢复圆角方钮，面板更有工具感。',benefit:'最易辨认',tradeoff:'比细线稍显眼，适合经常连续采集。',docked:'15 × 38',free:'40 × 40'},
 {id:'pebble',letter:'C',name:'轻胶囊',tag:'小圆弧 / 圆钮 / 横向快捷条',description:'把现在的大半圆缩成小圆弧，拖出即还原完整圆钮。展开后把采集与粘贴放在同一条操作线上。',benefit:'改动最小',tradeoff:'延续圆形手感，展开面板更矮。',docked:'16 × 30',free:'42 × 42'},
 {id:'rail',letter:'D',name:'侧边轨',tag:'极细边线 / 圆角方钮 / 侧抽屉',description:'平时只留一段细边线，拖出才出现完整按钮。点击拉出窄侧抽屉，操作逐行展开，不挤在一起。',benefit:'收起最隐蔽',tradeoff:'遮挡最少，但首次寻找入口稍费眼。',docked:'4 × 44',free:'40 × 40'}
];
const $=s=>document.querySelector(s),icon=name=>`<svg class="i ${name==='z'?'z':''}" aria-hidden="true"><use href="#${name}"/></svg>`;
let current=plans.find(p=>p.id===new URL(location.href).searchParams.get('plan'))||plans[0],model,timer,noticeTimer;
const libraries=['建模学习','灵感素材','未分类'];
function panel(plan){return `<section class="panel" aria-label="采集面板" hidden><button class="panel-heading" aria-label="点击标题收起，拖动标题移动">${icon('z')}<b>ZNote</b>${icon('down')}</button><label class="library-row">${icon('folder')}<select aria-label="目标知识库">${libraries.map(v=>`<option>${v}</option>`).join('')}</select>${icon('down')}</label><div class="action-block"><button class="primary capture" data-action="capture">${icon('capture')}<span>采集当前作品</span></button><div class="secondary"><button data-action="paste">${icon('paste')}粘贴链接</button><button data-action="browse">${icon('folder')}前往知识库</button></div></div><form class="paste-form" hidden><label>分享链接或整段分享文字<textarea aria-label="粘贴分享内容" placeholder="在这里长按粘贴，不用切换 App"></textarea></label><p class="validation" role="alert" hidden>请先粘贴包含 https:// 的作品分享内容。</p><button type="submit" class="primary">解析入库 ${icon('arrow')}</button></form><p class="panel-status" role="status" aria-live="polite"></p></section>`;}
function orb(docked=true){return `<button class="orb ${docked?'docked right':''}" aria-label="展开采集浮窗，可拖动换位置"><span class="shape">${icon('z')}<i class="mini-mark"></i><i class="ring"></i><i class="state-dot"></i></span></button>`;}
function device(plan){return `<div class="device variant-${plan.id}"><div class="screen"><div class="statusbar"><span>9:41</span><span class="signal">▂▄▆　▰</span></div><div class="source-scroll"><header class="source-header">${icon('back')}<span class="avatar">光</span><b>沿途的光</b><span class="follow">＋ 关注</span></header><svg class="scene" aria-label="建筑与光影示意图"><use href="#scene"/></svg><div class="pager"><i></i><i></i><i></i></div><article class="post-copy"><h3>在日常里，<br>收集一点好看的光。</h3><p>走过熟悉的街道，偶然抬头，<br>午后的光刚好落在那扇窗上。</p><p class="tags"># 光影记录　# 建筑灵感　# 慢慢看</p><small>今天 · 城市漫游</small><div class="scroll-evidence"><p>可以继续滚动浏览这里的内容，采集状态不会自动把面板展开。</p><p>窗边的阴影慢慢移动，生活里总有值得留下的一刻。</p></div></article></div><div class="source-footer"><span>说点什么…</span>${icon('star')}${icon('share')}</div><i class="home-indicator"></i><div class="capture-ui" data-status="idle" style="--x:338px;--y:300px">${orb()}${panel(plan)}<button class="notice" hidden></button></div></div></div>`;}
function sample(plan,kind){const status=kind==='result'?'success':'idle';return `<div class="sample-area variant-${plan.id}"><div class="capture-ui" data-status="${status}">${kind==='result'?`<span class="notice">${icon('check')}已存入 · 建模学习</span>`:orb(kind==='docked')}</div></div>`;}
function comparison(){
 $('#comparison').innerHTML=plans.map(p=>`<article class="compare-card"><header class="compare-head"><div><h3>${p.letter} · ${p.name}</h3><p>${p.tag}</p></div><button data-detail="${p.id}">动手试试 ${icon('arrow')}</button></header><div class="compare-body"><div class="mini-device" inert>${device(p)}</div><div class="state-specimens"><div class="specimen"><span>01 / 贴边 · ${p.docked} dp 视觉</span>${sample(p,'docked')}</div><div class="specimen"><span>02 / 拖离 · ${p.free} dp</span>${sample(p,'free')}</div><div class="specimen"><span>03 / 完成 · 线条图标</span>${sample(p,'result')}</div><p class="spec-note">松手吸回近侧<br>采集时自动收起<br>结果不强行展开</p></div></div><p class="comparison-note"><b>${p.benefit}</b><span>${p.tradeoff}</span></p></article>`).join('');
 document.querySelectorAll('.mini-device .panel').forEach(e=>{e.hidden=false;e.style.setProperty('--panel-y','305px');});document.querySelectorAll('.mini-device .orb').forEach(e=>e.hidden=true);
 $('#comparison').querySelectorAll('[data-detail]').forEach(b=>b.onclick=()=>{document.body.classList.remove('board');choosePlan(b.dataset.detail);$('.workbench').scrollIntoView({behavior:'smooth',block:'start'});});
}
function clearTimers(){clearTimeout(timer);clearTimeout(noticeTimer);}
function choosePlan(id){
 clearTimers();current=plans.find(p=>p.id===id)||plans[0];const url=new URL(location.href);url.searchParams.set('plan',current.id);url.searchParams.delete('board');history.replaceState(null,'',url.pathname+url.search);
 $('#plans').querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.plan===current.id)));$('#plan-label').textContent=`${current.letter} / ${current.name}`;$('#plan-title').textContent=current.name;$('#plan-description').textContent=current.description;$('#choose').textContent=`选 ${current.letter} · ${current.name}`;$('#selection').textContent='';$('#live').innerHTML=device(current);
 const root=$('#live .capture-ui'),screen=$('#live .screen');model={root,screen,orb:root.querySelector('.orb'),panel:root.querySelector('.panel'),notice:root.querySelector('.notice'),side:'right',x:screen.clientWidth-12,y:300,status:'idle',library:'建模学习',captureLibrary:'建模学习',open:false,docked:true};
 position();bind();status('idle');
}
function position(){
 const m=model,w=m.screen.clientWidth,h=m.screen.clientHeight;m.y=Math.min(h-93,Math.max(85,m.y));m.x=m.docked?(m.side==='right'?w-12:12):Math.min(w-25,Math.max(25,m.x));m.root.style.setProperty('--x',m.x+'px');m.root.style.setProperty('--y',m.y+'px');m.orb.classList.toggle('docked',m.docked);m.orb.classList.toggle('right',m.side==='right');m.orb.classList.toggle('left',m.side==='left');m.panel.classList.toggle('left',m.side==='left');
 const py=Math.min(Math.max(65,m.y-45),Math.max(65,h-m.panel.offsetHeight-32));m.panel.style.setProperty('--panel-y',py+'px');m.root.style.setProperty('--ny',Math.min(h-105,Math.max(65,m.y-19))+'px');m.root.style.setProperty('--nr',m.side==='right'?'34px':'auto');m.root.style.setProperty('--nl',m.side==='left'?'34px':'auto');
}
function dock(side=model.side){model.side=side;model.docked=true;model.orb.classList.remove('dragging');position();}
function expand(value){model.open=value;model.panel.hidden=!value;model.orb.hidden=value;model.notice.hidden=true;if(value){clearTimeout(noticeTimer);model.panel.querySelector('.capture').focus({preventScroll:true});}position();}
function status(value,{brief=false}={}){
 const m=model;m.status=value;m.root.dataset.status=value;document.querySelectorAll('#state-picker button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.status===value)));
 const text=m.panel.querySelector('.panel-status'),capture=m.panel.querySelector('.capture');capture.disabled=value==='working';capture.querySelector('span').textContent=value==='error'?'重试当前作品':value==='working'?'后台保存中':'采集当前作品';text.classList.toggle('error',value==='error');
 text.innerHTML=value==='error'?`${icon('alert')}连接暂时中断，任务保留。可重试。`:value==='success'?`${icon('check')}已存入 · ${m.captureLibrary}`:value==='working'?'正在保存，可以继续浏览。':'';
 m.orb.setAttribute('aria-label',(value==='success'?'已保存':value==='error'?'未保存，可重试':value==='working'?'正在后台采集':'展开采集浮窗')+'，可拖动换位置');
 if(value==='success'||value==='error'){
  m.notice.dataset.error=String(value==='error');m.notice.innerHTML=value==='success'?`${icon('check')}已存入 · ${m.captureLibrary}`:`${icon('alert')}未保存 · 点开重试`;m.notice.hidden=m.open;clearTimeout(noticeTimer);if(value==='success'&&brief)noticeTimer=setTimeout(()=>{m.notice.hidden=true;},2300);
 }else m.notice.hidden=true;
 position();
}
function collect(){clearTimers();model.captureLibrary=model.library;model.panel.querySelector('.paste-form').hidden=true;expand(false);dock();status('working');timer=setTimeout(()=>status('success',{brief:true}),1900);}
function message(text){const old=model.screen.querySelector('.phone-message');old?.remove();const n=document.createElement('div');n.className='phone-message';n.setAttribute('role','status');n.textContent=text;model.screen.append(n);setTimeout(()=>n.remove(),2300);}
function bind(){
 const m=model;drag(m.orb);drag(m.panel.querySelector('.panel-heading'));m.notice.onclick=()=>expand(true);m.panel.querySelector('select').onchange=e=>{m.library=e.target.value;};
 m.panel.querySelector('[data-action=capture]').onclick=collect;m.panel.querySelector('[data-action=paste]').onclick=()=>{const form=m.panel.querySelector('.paste-form');form.hidden=!form.hidden;position();if(!form.hidden)form.querySelector('textarea').focus({preventScroll:true});};
 m.panel.querySelector('[data-action=browse]').onclick=()=>{expand(false);dock();message('演示：这里会打开 ZNote 知识库');};
 m.panel.querySelector('form').onsubmit=e=>{e.preventDefault();const form=e.currentTarget,value=form.querySelector('textarea').value;if(!/https:\/\/[^\s]+/i.test(value)){form.querySelector('.validation').hidden=false;position();return;}form.querySelector('.validation').hidden=true;collect();};
 m.root.onkeydown=e=>{if(e.key==='Escape'){if(!m.panel.querySelector('.paste-form').hidden){m.panel.querySelector('.paste-form').hidden=true;position();}else{expand(false);dock();m.orb.focus({preventScroll:true});}}};
 m.screen.querySelector('.source-scroll').onclick=()=>{if(m.open){expand(false);dock();}};
}
function drag(el){
 let start,dragged=false;
 el.addEventListener('pointerdown',e=>{if(e.button!==0)return;start={x:e.clientX,y:e.clientY,mx:model.x,my:model.y,id:e.pointerId};dragged=false;el.setPointerCapture(e.pointerId);});
 el.addEventListener('pointermove',e=>{if(!start||e.pointerId!==start.id)return;const dx=e.clientX-start.x,dy=e.clientY-start.y;if(!dragged&&Math.hypot(dx,dy)<6)return;if(!dragged){dragged=true;model.panel.hidden=true;model.orb.hidden=false;model.open=false;model.notice.hidden=true;}model.orb.classList.add('dragging');model.x=start.mx+dx;model.y=start.my+dy;const w=model.screen.clientWidth;model.side=model.x<w/2?'left':'right';model.docked=model.x<20||model.x>w-20;position();});
 const finish=(e,cancel=false)=>{if(!start||e.pointerId!==start.id)return;start=null;if(el.hasPointerCapture(e.pointerId))el.releasePointerCapture(e.pointerId);if(dragged||cancel){dock();}else{expand(!model.open);}dragged=false;};
 el.addEventListener('pointerup',e=>finish(e));el.addEventListener('pointercancel',e=>finish(e,true));el.addEventListener('lostpointercapture',()=>{if(start){start=null;dock();}});
 el.addEventListener('click',e=>{if(e.detail===0)expand(!model.open);});
 el.addEventListener('keydown',e=>{if(!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();if(e.key==='ArrowUp')model.y-=24;if(e.key==='ArrowDown')model.y+=24;if(e.key==='ArrowLeft')model.side='left';if(e.key==='ArrowRight')model.side='right';dock();});
}
$('#plans').innerHTML=plans.map(p=>`<button class="plan-tab" data-plan="${p.id}" aria-pressed="false"><span class="tab-shape"><i></i></span><span><b>${p.letter} · ${p.name}</b><small>${p.benefit}</small></span></button>`).join('');$('#plans').querySelectorAll('button').forEach(b=>b.onclick=()=>choosePlan(b.dataset.plan));
$('#state-picker').querySelectorAll('button').forEach(b=>b.onclick=()=>{clearTimers();expand(false);dock();status(b.dataset.status);});$('#show-docked').onclick=()=>{expand(false);dock();};$('#show-free').onclick=()=>{expand(false);model.docked=false;model.x=model.screen.clientWidth*.60;model.y=285;model.orb.classList.remove('dragging');position();};$('#show-panel').onclick=()=>expand(true);
$('#choose').onclick=()=>{$('#selection').textContent=`已选 ${current.letter} · ${current.name}。在对话里告诉我即可；未修改真实 App。`;};document.querySelector('[data-logo]').innerHTML=icon('z');const board=new URL(location.href).searchParams.get('board')==='1';choosePlan(current.id);comparison();if(board)document.body.classList.add('board');
window.addEventListener('resize',()=>{if(model)position();});document.addEventListener('visibilitychange',()=>{if(document.hidden){clearTimers();if(model.status==='working')status('idle');}});
