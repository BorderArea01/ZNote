// Build the same group identity for previews, navigation, and sorting. The
// member id is convenient, while the key/library pair remains stable when a
// cover was moved or an older folded card is still open.
export function groupOrderPath({id, kind, groupKey, collectionId} = {}) {
  const query = new URLSearchParams();
  if (id) query.set('id', id);
  if (kind) query.set('kind', kind);
  if (groupKey) query.set('group_key', groupKey);
  if (collectionId !== undefined) query.set('collection', collectionId || 'unfiled');
  return `/api/item-groups/order?${query}`;
}

