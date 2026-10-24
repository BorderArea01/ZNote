import {isMediaGroup} from './media-group.js';

// Resolve a group before changing its star, so folded or filtered members stay
// together. The server rejects a changed version/group rather than partially
// applying the operation.
export async function toggleDefaultFavorite(send, item, collection) {
  const snapshot = await send('/api/favorite-targets/preview', {
    items: [{id:item.id, version:item.version, group:isMediaGroup(item)}],
    collection_id: collection,
  });
  return send('/api/favorite-targets', {
    items:snapshot.items.map(({id,version})=>({id,version})),
    collection_id:collection, groups:snapshot.groups,
    favorite:snapshot.favorite_count!==snapshot.items.length, undo:true,
  });
}
