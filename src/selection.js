export const SELECTION_LIMIT = 10000;

export function changeSelection(previous, ids, mode = 'toggle') {
  const next = new Set(previous);
  const targets = [...new Set(ids)];
  const remove = mode === 'remove' || (mode === 'toggle' && targets.every(id => next.has(id)));
  for (const id of targets) {
    if (mode === 'invert' ? next.has(id) : remove) next.delete(id);
    else next.add(id);
  }
  if (next.size > SELECTION_LIMIT) throw Error(`单次最多选择 ${SELECTION_LIMIT} 项，请缩小筛选范围`);
  return [...next];
}

// Stage a complete, version-consistent selection before changing the UI. A
// cancelled or failed page must never silently become a partial "select all".
export async function collectSelection(read, query, { signal, onProgress = () => {} } = {}) {
  const params = new URLSearchParams(query);
  params.delete('anchor'); params.delete('cursor'); params.delete('gallery');
  params.set('grouped', 'false'); params.set('summary', 'true'); params.set('limit', '100');
  const rows = new Map();
  let cursor, total;
  for (let offset = 0; ; offset += 100) {
    signal?.throwIfAborted();
    params.set('offset', String(offset));
    if (cursor !== undefined) params.set('cursor', String(cursor));
    const result = await read('/api/items?' + params, { signal });
    signal?.throwIfAborted();
    if (result.total > SELECTION_LIMIT) throw Error(`当前筛选超过 ${SELECTION_LIMIT} 项，请先缩小范围`);
    if (cursor !== undefined && (cursor !== result.event_cursor || total !== result.total)) throw Error('内容已变化，请重试全选');
    cursor = result.event_cursor; total = result.total;
    for (const { id, version, kind, title, collection_id, deleted_at, group_key, favorite } of result.items) {
      rows.set(id, { id, version, kind, title, collection_id, deleted_at, group_key, favorite });
    }
    onProgress({ loaded: rows.size, total });
    if (offset + result.items.length >= total) break;
    if (!result.items.length) throw Error('内容已变化，请重试全选');
  }
  if (rows.size !== total) throw Error('内容已变化，请重试全选');
  return [...rows.values()];
}
