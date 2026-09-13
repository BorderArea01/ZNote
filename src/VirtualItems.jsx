import React, { useLayoutEffect, useRef, useState } from 'react';

// A bounded DOM window over already loaded records. Small pages remain native
// grids; large lists retain a focused row so keyboard focus is never unmounted.
export function VirtualItems({ items, layout, restoreId, children }) {
  const root = useRef(null);
  const [windowed, setWindowed] = useState({ start: 0, end: 60, columns: 1, stride: 350, gap: 0, focused: -1 });
  const virtual = items.length > 120;
  useLayoutEffect(() => {
    const node = root.current;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const css = getComputedStyle(node);
      const columns = layout === 'list' ? 1 : css.gridTemplateColumns.split(' ').length;
      const card = node.querySelector('.item-card');
      const gap = parseFloat(css.rowGap) || 0;
      const stride = (card?.offsetHeight || 350) + gap;
      const first = Math.max(0, Math.floor(-node.getBoundingClientRect().top / stride) - 3);
      const visible = Math.ceil(innerHeight / stride) + 7;
      const start = Math.min(first, Math.max(0, Math.ceil(items.length / columns) - visible)) * columns;
      const focusedId = document.activeElement?.closest('.item-card')?.dataset.itemId;
      const focused = focusedId ? items.findIndex(i => i.id === focusedId) : -1;
      const next = { start, end: Math.min(items.length, start + visible * columns), columns, stride, gap, focused };
      setWindowed(old => Object.keys(next).every(k => next[k] === old[k]) ? old : next);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    const observer = new ResizeObserver(schedule);
    observer.observe(node);
    const card = node.querySelector('.item-card'); if (card) observer.observe(card);
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    node.addEventListener('focusin', schedule); node.addEventListener('focusout', schedule);
    measure();
    return () => { cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener('scroll', schedule); window.removeEventListener('resize', schedule); node.removeEventListener('focusin', schedule); node.removeEventListener('focusout', schedule); };
  }, [items, layout]);
  const { start, end, columns, stride, gap, focused } = windowed;
  const rows = Math.ceil(items.length / columns);
  const visibleRows = new Set();
  if (virtual) {
    for (let row = Math.floor(start / columns); row < Math.ceil(end / columns); row++) visibleRows.add(row);
    if (focused >= 0) {
      const focusRow = Math.floor(focused / columns);
      for (let row = Math.max(0, focusRow - 1); row <= Math.min(rows - 1, focusRow + 1); row++) visibleRows.add(row);
    }
    const restoreIndex = restoreId ? items.findIndex(item => item.id === restoreId) : -1;
    if (restoreIndex >= 0) visibleRows.add(Math.floor(restoreIndex / columns));
  }
  const rendered = [];
  let cursor = 0;
  if (virtual) {
    for (const row of [...visibleRows].sort((a, b) => a - b)) {
      if (row > cursor) rendered.push(<div key={`gap-${cursor}`} aria-hidden="true" style={{ gridColumn: '1 / -1', height: (row - cursor) * stride - gap }} />);
      for (let i = row * columns; i < Math.min(items.length, (row + 1) * columns); i++) rendered.push(children(items[i], i));
      cursor = row + 1;
    }
    if (cursor < rows) rendered.push(<div key="gap-end" aria-hidden="true" style={{ gridColumn: '1 / -1', height: (rows - cursor) * stride - gap }} />);
  }
  return <div ref={root} className={`items ${layout}`} data-virtual={virtual || undefined} style={{ overflowAnchor: 'none' }}>{virtual ? rendered : items.map(children)}</div>;
}
