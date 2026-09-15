const KEY = 'znote:browse:v1';
const views = new Set(['all', 'images', 'videos', 'notes', 'favorites', 'trash']);
const defaults = { query: '', tags: [], mode: 'all', sort: 'updated', direction: 'desc', type_group: false, type_order:'image,group,note,video', layout: 'grid', anchor: null, offset: 0, awayFromStart: false };
function read() {
  try { const value = JSON.parse(localStorage.getItem(KEY)); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
  catch { return {}; }
}
export function readBrowse(library, view) {
  const record = read()[library];
  const target = views.has(view) ? view : views.has(record?.view) ? record.view : 'all';
  const raw = record?.views?.[target] || {};
  return { ...defaults, view: target,
    query: typeof raw.query === 'string' ? raw.query.slice(0, 200) : '',
    tags: Array.isArray(raw.tags) ? raw.tags.filter(t => typeof t === 'string').slice(0, 30) : [],
    mode: raw.mode === 'any' ? 'any' : 'all',
    sort: ['updated', 'created', 'title'].includes(raw.sort) ? raw.sort : 'updated',
    direction: ['asc','desc'].includes(raw.direction) ? raw.direction : raw.sort === 'title' ? 'asc' : 'desc',
    type_group: raw.type_group === true,
    type_order: typeof raw.type_order==='string'&&raw.type_order.split(',').length===4&&new Set(raw.type_order.split(',')).size===4&&raw.type_order.split(',').every(x=>['image','group','note','video'].includes(x))?raw.type_order:'image,group,note,video',
    layout: ['grid','list','compact-grid','compact-list'].includes(raw.layout) ? raw.layout : 'grid',
    anchor: typeof raw.anchor?.id === 'string' && Number.isFinite(raw.anchor.top) ? raw.anchor : null,
    offset: Number.isInteger(raw.offset) && raw.offset > 0 ? raw.offset : 0,
    awayFromStart: raw.awayFromStart === true || (Number.isInteger(raw.offset) && raw.offset > 0),
  };
}
export function writeBrowse(library, view, state) {
  if (!library || !views.has(view)) return;
  try {
    const records = read();
    records[library] = { view, updated: Date.now(), views: { ...records[library]?.views, [view]: state } };
    const bounded = Object.fromEntries(Object.entries(records).sort((a, b) => (b[1]?.updated || 0) - (a[1]?.updated || 0)).slice(0, 80));
    localStorage.setItem(KEY, JSON.stringify(bounded));
  } catch { /* Browsing also works when local storage is unavailable. */ }
}
export function captureAnchor() {
  const cards = document.querySelectorAll('.item-card[data-item-id]');
  for (const card of cards) {
    const rect = card.getBoundingClientRect();
    if (rect.bottom > 0 && rect.top < innerHeight) return { id: card.dataset.itemId, top: rect.top };
  }
  return null;
}
