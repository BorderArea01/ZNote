import React, { useEffect, useRef } from 'react';

export function PageLoader({ automatic, disabled, onLoad, children }) {
  const button = useRef(null), action = useRef(onLoad);
  action.current = onLoad;
  useEffect(() => {
    if (!automatic || disabled || !globalThis.IntersectionObserver) return;
    let active = true;
    const observer = new IntersectionObserver(entries => {
      if (active && entries.some(e => e.isIntersecting) && !document.hidden && !document.querySelector('[role="dialog"]')) action.current(true);
    }, { rootMargin: '0px 0px 400px 0px' });
    observer.observe(button.current);
    return () => { active = false; observer.disconnect(); };
  }, [automatic, disabled, children]);
  return <button ref={button} className="load-more" disabled={disabled} onClick={() => onLoad(false)}>{children}</button>;
}

export function readAutoPages() {
  try { return localStorage.getItem('znote:auto-pages') !== 'false'; } catch { return true; }
}
export function saveAutoPages(value) {
  try { localStorage.setItem('znote:auto-pages', String(value)); } catch { /* Still works for this visit. */ }
}
