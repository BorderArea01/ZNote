const fail = message => Object.assign(Error(message), { status: 422 });
export function xPost(value) {
  try {
    const url = new URL(value);
    const match = url.pathname.match(/^\/([\w]+)\/status\/(\d{1,40})(?:\/(?:photo|video)\/\d+)?\/?$/);
    if (url.protocol !== 'https:' || !/^(?:www\.|mobile\.)?(?:x|twitter)\.com$/.test(url.hostname) || !match) return null;
    return { id: match[2], url: `https://x.com/${match[1]}/status/${match[2]}` };
  } catch { return null; }
}
export function xImage(value, size = 'orig') {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'pbs.twimg.com' || !url.pathname.startsWith('/media/')) return '';
    const ext = url.pathname.match(/\.(jpg|jpeg|png|webp)$/i)?.[1];
    if (ext) { url.pathname = url.pathname.slice(0, -ext.length - 1); url.searchParams.set('format', ext); }
    if (!/^(jpg|jpeg|png|webp)$/i.test(url.searchParams.get('format') || '')) return '';
    url.searchParams.set('name', size);
    return url.href;
  } catch { return ''; }
}
export function extractXPost(data, source) {
  const post = xPost(source);
  if (!post || String(data?.id_str) !== post.id || data.__typename === 'TweetTombstone')
    throw fail('X 未提供这条推文的完整数据，可能已删除或需要登录');
  const media = Array.isArray(data.mediaDetails) ? data.mediaDetails.filter(m => m.type === 'photo').map(m => m.media_url_https) : (data.photos || []).map(p => p.url);
  const images = [...new Set(media.map(value => xImage(value)).filter(Boolean))];
  const author = [data.user?.name, data.user?.screen_name ? `@${data.user.screen_name}` : ''].filter(Boolean).join(' ');
  let content = String(data.text || '');
  // Expand actual outbound links, retaining the text and excluding only the
  // trailing media short-link whose images are archived separately.
  for (const entity of data.entities?.urls || []) if (entity.url && entity.expanded_url) content = content.replaceAll(entity.url, entity.expanded_url);
  for (const entity of data.entities?.media || []) if (entity.url) content = content.replaceAll(entity.url, '');
  const details = { url: post.url, title: (content.trim().split('\n').find(Boolean) || `X · ${author || post.id}`).slice(0, 200), content: content.trim(), author, tags: (data.entities?.hashtags || []).map(v => v.text).filter(Boolean) };
  if (images.length) return { ...details, kind: 'note', images, image_candidates: images.map(url => [url, xImage(url, 'large')]) };
  if (data.video || data.mediaDetails?.some(m => ['video', 'animated_gif'].includes(m.type))) return { ...details, kind: 'video' };
  if (details.content) return { ...details, kind: 'note', images: [] };
  throw fail('这条 X 推文没有可采集的正文或媒体');
}
