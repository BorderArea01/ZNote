// Local, keyboard- and touch-accessible guidance for extension settings.
for (const source of document.querySelectorAll('[data-help-for]')) {
  const heading = document.getElementById(source.dataset.helpFor);
  if (!heading) continue;
  const trigger = document.createElement('button'), tooltip = document.createElement('div');
  trigger.type = 'button'; trigger.className = 'help-trigger'; trigger.textContent = '?';
  trigger.setAttribute('aria-label', source.dataset.helpLabel + '说明');
  tooltip.id = source.dataset.helpFor + '-help'; tooltip.className = 'help-tooltip'; tooltip.hidden = true;
  tooltip.setAttribute('role', 'tooltip'); tooltip.textContent = source.textContent.trim();
  heading.append(trigger); document.body.append(tooltip); source.remove();
  let timer, pointerType = 'mouse';
  const close = () => { clearTimeout(timer); tooltip.hidden = true; trigger.removeAttribute('aria-describedby'); };
  const show = () => {
    clearTimeout(timer); tooltip.hidden = false; trigger.setAttribute('aria-describedby', tooltip.id);
    const a = trigger.getBoundingClientRect(), b = tooltip.getBoundingClientRect();
    tooltip.style.left = Math.max(8, Math.min(a.left, innerWidth - b.width - 8)) + 'px';
    tooltip.style.top = (a.bottom + b.height + 8 < innerHeight ? a.bottom + 6 : Math.max(8,a.top-b.height-6)) + 'px';
  };
  const leave = () => { clearTimeout(timer); timer = setTimeout(close,120); };
  trigger.addEventListener('pointerenter', e => { if (e.pointerType !== 'touch') show(); });
  trigger.addEventListener('pointerleave', leave);
  trigger.addEventListener('pointerdown', e => { pointerType = e.pointerType; });
  trigger.addEventListener('focus', () => { if (pointerType !== 'touch') show(); });
  trigger.addEventListener('blur', leave);
  trigger.addEventListener('click', () => { if (pointerType === 'touch' && !tooltip.hidden) close(); else show(); });
  tooltip.addEventListener('pointerenter', () => clearTimeout(timer)); tooltip.addEventListener('pointerleave', leave);
  document.addEventListener('keydown', e => { if(e.key==='Escape') close(); });
  document.addEventListener('pointerdown', e => { if(!trigger.contains(e.target) && !tooltip.contains(e.target)) close(); });
  window.addEventListener('scroll',close,true); window.addEventListener('resize',close);
}
