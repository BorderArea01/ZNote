// A folded card represents a media group when it contains more than one
// image or video in the current knowledge-base scope. Notes keep their own
// image-group semantics and are intentionally excluded here.
export const isMediaGroup = item =>
  !!(item && (item.kind === 'image' || item.kind === 'video') && item.group_key && Number(item.group_size ?? item.group_count ?? 0) > 1);

export const isImageGroup = item => isMediaGroup(item) && item.kind === 'image';
export const isVideoGroup = item => isMediaGroup(item) && item.kind === 'video';
