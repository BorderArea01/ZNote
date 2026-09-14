// Count the complete group in its library, never just the filtered matches.
export const isImageGroup = item => !!(item?.kind === 'image' && item.group_key && Number(item.group_size ?? item.group_count ?? 0) > 1);
