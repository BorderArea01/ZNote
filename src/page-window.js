export const PAGE_SIZE = 60;
export const WINDOW_LIMIT = 600;

// Pages belong to one server event cursor. Never silently deduplicate a shifted
// offset: that would make later pages skip records.
export function extendPageWindow(items, offset, page, previous) {
  const expected = previous ? Math.max(0, offset - PAGE_SIZE) : offset + items.length;
  const known = new Set(items.map(row => row.id));
  if (page.offset !== expected || !page.items.length || page.items.some(row => known.has(row.id))) throw Error('内容分页已变化，请刷新后继续浏览');
  const combined = previous ? [...page.items, ...items] : [...items, ...page.items];
  const remove = Math.max(0, Math.ceil((combined.length - WINDOW_LIMIT) / PAGE_SIZE) * PAGE_SIZE);
  return {
    items: previous ? combined.slice(0, combined.length - remove) : combined.slice(remove),
    offset: previous ? page.offset : offset + remove,
    trimmed: remove > 0,
  };
}
