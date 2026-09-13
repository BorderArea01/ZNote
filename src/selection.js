export const SELECTION_LIMIT = 10000;

// Resolve folded cards to real members before committing any selection. A
// failed/stale group must not leave a half-applied range or page selection.
export async function resolveSelectionCards(read, cards, {collectionId, trash, signal} = {}) {
  const groups = {}, rows = new Map(), targets = new Map();
  for (const card of cards) targets.set(card.group_key && card.group_count ? 'group:'+card.group_key : card.id, card);
  const queue = [...targets.values()];
  let failure;
  await Promise.all(Array.from({length:Math.min(4,queue.length)},async()=>{
    try { while(queue.length&&!failure){
      signal?.throwIfAborted();
      const card=queue.shift();
      if(card.group_key&&card.group_count){
        const result=await read('/api/item-groups/selection?id='+encodeURIComponent(card.id),{signal});
        signal?.throwIfAborted();
        if(result.collection_id!==collectionId||result.trash!==trash||result.group_key!==card.group_key)throw Error('图片组已移动、删除或重新分组，请刷新后选择');
        groups[result.group_key]=result.items.map(row=>row.id);
        result.items.forEach((row,index)=>rows.set(row.id,{...row,title:row.title||`第 ${index+1} 张`,collection_id:result.collection_id,group_key:result.group_key,deleted_at:result.trash?true:null}));
      }else rows.set(card.id,card);
      if(rows.size>SELECTION_LIMIT)throw Error(`单次最多选择 ${SELECTION_LIMIT} 项，请缩小选择范围`);
    } } catch(error) { failure ||= error; }
  }));
  if(failure)throw failure;
  return {rows:[...targets.values()].flatMap(card=>card.group_key&&card.group_count?groups[card.group_key].map(id=>rows.get(id)):[rows.get(card.id)]),groups};
}

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
