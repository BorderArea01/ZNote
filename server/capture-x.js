import {z} from 'zod';
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
    if (url.protocol !== 'https:' || url.hostname !== 'pbs.twimg.com' || url.username || url.password || url.port&&url.port!=='443' || !url.pathname.startsWith('/media/')) return '';
    const ext = url.pathname.match(/\.(jpg|jpeg|png|webp)$/i)?.[1];
    if (ext) { url.pathname = url.pathname.slice(0, -ext.length - 1); url.searchParams.set('format', ext); }
    if (!/^(jpg|jpeg|png|webp)$/i.test(url.searchParams.get('format') || '')) return '';
    url.searchParams.set('name', size);
    return url.href;
  } catch { return ''; }
}
export function xVideo(value){
  try{const url=new URL(value);return url.protocol==='https:'&&url.hostname==='video.twimg.com'&&!url.username&&!url.password&&!url.port&&/\.mp4$/i.test(url.pathname)&&!/(?:^|[/_-])init(?:[._/-]|$)/i.test(url.pathname)?url.href:'';}catch{return '';}
}
export function extractXPost(data, source) {
  const post = xPost(source);
  if (!post || String(data?.id_str) !== post.id || data.__typename === 'TweetTombstone')
    throw fail('X 公开接口未返回这条推文的内容；这不代表推文已删除。请打开原帖，显示正文和媒体后用网页内采集入口重试');
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
  if (data.video || data.mediaDetails?.some(m => ['video', 'animated_gif'].includes(m.type))) {
    const variants=[...(data.video?.variants||[]),...(data.mediaDetails||[]).filter(m=>['video','animated_gif'].includes(m.type)).flatMap(m=>m.video_info?.variants||m.video?.variants||[])];
    const video_urls=[...new Set(variants.sort((a,b)=>(Number(b.bitrate)||0)-(Number(a.bitrate)||0)).map(v=>xVideo(v.url||v.src)).filter(Boolean))].slice(0,16);
    return { ...details, kind: 'video',...(video_urls.length?{video_urls}:{}) };
  }
  if (details.content) return { ...details, kind: 'note', images: [] };
  throw fail('这条 X 推文没有可采集的正文或媒体');
}

const browserPostSchema=z.object({
  id:z.string().regex(/^\d{1,40}$/),text:z.string().max(100000),
  images:z.array(z.string().max(2048)).max(4),
  author:z.object({name:z.string().max(200),screen_name:z.string().regex(/^\w{1,50}$/)}),
  video:z.boolean().default(false),
  video_urls:z.array(z.string().max(2048)).max(16).optional(),
}).strict();
export function extractBrowserXPost(raw,source){
  const post=xPost(source),parsed=browserPostSchema.safeParse(raw);
  if(!post||!parsed.success||parsed.data.id!==post.id)throw fail('浏览器推文数据与当前链接不匹配，未采集');
  const data=parsed.data;
  if(data.images.some(url=>!xImage(url)))throw fail('浏览器推文包含无效的 X 图片地址，未采集');
  if(data.video_urls?.some(url=>!xVideo(url)))throw fail('浏览器推文包含无效的 X 视频地址，未采集');
  if(data.video&&!data.video_urls?.length)throw fail('浏览器未提供这条推文的播放地址，请在原帖播放视频后重试');
  // Reuse the same normalization and ordered-group parser as the public API.
  return extractXPost({id_str:data.id,text:data.text,user:data.author,entities:{hashtags:[...data.text.matchAll(/(?:^|\s)#([\p{L}\p{N}_]+)/gu)].map(match=>({text:match[1]}))},mediaDetails:data.images.map(url=>({type:'photo',media_url_https:url})),...(data.video?{video:{variants:(data.video_urls||[]).map(url=>({url}))}}:{})},post.url);
}
