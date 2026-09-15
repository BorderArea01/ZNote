import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CircleHelp } from 'lucide-react';
import {useAppBack} from './back-navigation.js';

export function HelpHint({ label = '帮助', children }) {
  const id = useId(), trigger = useRef(null), bubble = useRef(null), timer = useRef(), pointerType = useRef('mouse'), pinned = useRef(false);
  const [open, setOpen] = useState(false), [position, setPosition] = useState({ left: 8, top: 8 });
  const touch = useRef(null), touchHandled = useRef(false);
  const dismiss = () => { clearTimeout(timer.current); pinned.current=false; setOpen(false); };
  const toggle = () => { clearTimeout(timer.current); if(pinned.current)dismiss();else{pinned.current=true;setOpen(true);} };
  useAppBack(dismiss,open,300);
  const show = () => { clearTimeout(timer.current); setOpen(true); };
  const leave = () => { clearTimeout(timer.current); if(!pinned.current)timer.current = setTimeout(dismiss, 120); };
  useEffect(() => () => clearTimeout(timer.current), []);
  useLayoutEffect(() => {
    if (!open) return;
    const a = trigger.current.getBoundingClientRect(), b = bubble.current.getBoundingClientRect();
    setPosition({ left: Math.max(8, Math.min(a.left, innerWidth - b.width - 8)),
      top: a.bottom + b.height + 8 < innerHeight ? a.bottom + 6 : Math.max(8, a.top - b.height - 6) });
    const keydown = e => { if (e.key === 'Escape') { e.stopImmediatePropagation(); dismiss(); } };
    const outside = e => { if (!trigger.current?.contains(e.target) && !bubble.current?.contains(e.target)) dismiss(); };
    document.addEventListener('keydown', keydown, true);
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('resize', dismiss);
    const scroll = e => { if(!bubble.current?.contains(e.target))dismiss(); };
    window.addEventListener('scroll', scroll, true);
    return () => {
      document.removeEventListener('keydown', keydown, true); document.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('resize', dismiss); window.removeEventListener('scroll', scroll, true);
    };
  }, [open]);
  return <>
    <button ref={trigger} type="button" className="help-trigger" aria-label={`${label}说明`} aria-expanded={open} aria-controls={open?id:undefined} aria-describedby={open ? id : undefined}
      onPointerEnter={e => { if (e.pointerType === 'mouse') show(); }} onPointerLeave={leave}
      onPointerDown={e => { pointerType.current = e.pointerType; touchHandled.current=false; touch.current=e.pointerType==='touch'?{x:e.clientX,y:e.clientY}:null; }}
      onPointerMove={e => { if(touch.current&&Math.hypot(e.clientX-touch.current.x,e.clientY-touch.current.y)>8)touch.current=null; }}
      onPointerCancel={() => { touch.current=null; }}
      onPointerUp={e => { if(e.pointerType==='touch'&&touch.current){touch.current=null;touchHandled.current=true;e.stopPropagation();toggle();} }}
      onFocus={() => { if (pointerType.current === 'mouse') show(); }} onBlur={leave}
      onClick={e => { e.stopPropagation(); if(touchHandled.current&&e.detail!==0){touchHandled.current=false;return;}toggle(); }}>
      <CircleHelp size={16} aria-hidden="true" />
    </button>
    {open && createPortal(<div ref={bubble} id={id} role="tooltip" className="help-tooltip" style={position}
      onPointerEnter={() => clearTimeout(timer.current)} onPointerLeave={leave}>
      <strong>{label}</strong><div>{children}</div>
    </div>, trigger.current?.closest('dialog') || document.body)}
  </>;
}
