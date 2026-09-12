import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CircleHelp } from 'lucide-react';

export function HelpHint({ label = '帮助', children }) {
  const id = useId(), trigger = useRef(null), bubble = useRef(null), timer = useRef(), pointerType = useRef('mouse');
  const [open, setOpen] = useState(false), [position, setPosition] = useState({ left: 8, top: 8 });
  const show = () => { clearTimeout(timer.current); setOpen(true); };
  const leave = () => { clearTimeout(timer.current); timer.current = setTimeout(() => setOpen(false), 120); };
  useEffect(() => () => clearTimeout(timer.current), []);
  useLayoutEffect(() => {
    if (!open) return;
    const a = trigger.current.getBoundingClientRect(), b = bubble.current.getBoundingClientRect();
    setPosition({ left: Math.max(8, Math.min(a.left, innerWidth - b.width - 8)),
      top: a.bottom + b.height + 8 < innerHeight ? a.bottom + 6 : Math.max(8, a.top - b.height - 6) });
    const dismiss = () => setOpen(false);
    const keydown = e => { if (e.key === 'Escape') { e.stopImmediatePropagation(); dismiss(); } };
    const outside = e => { if (!trigger.current?.contains(e.target) && !bubble.current?.contains(e.target)) dismiss(); };
    document.addEventListener('keydown', keydown, true);
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('resize', dismiss);
    window.addEventListener('scroll', dismiss, true);
    return () => {
      document.removeEventListener('keydown', keydown, true); document.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('resize', dismiss); window.removeEventListener('scroll', dismiss, true);
    };
  }, [open]);
  return <>
    <button ref={trigger} type="button" className="help-trigger" aria-label={`${label}说明`} aria-describedby={open ? id : undefined}
      onPointerEnter={e => { if (e.pointerType !== 'touch') show(); }} onPointerLeave={leave}
      onPointerDown={e => { pointerType.current = e.pointerType; }}
      onFocus={() => { if (pointerType.current !== 'touch') show(); }} onBlur={leave}
      onClick={e => { e.stopPropagation(); if (pointerType.current === 'touch') setOpen(v => !v); else show(); }}>
      <CircleHelp size={16} aria-hidden="true" />
    </button>
    {open && createPortal(<div ref={bubble} id={id} role="tooltip" className="help-tooltip" style={position}
      onPointerEnter={() => clearTimeout(timer.current)} onPointerLeave={leave}>
      <strong>{label}</strong><div>{children}</div>
    </div>, document.body)}
  </>;
}
