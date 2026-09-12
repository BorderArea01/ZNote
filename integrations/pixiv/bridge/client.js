// ZNote integration, GPL-3.0-or-later.
import TurndownService from 'turndown';
import { pximg } from './records.js';
const markdown = new TurndownService({ headingStyle: 'atx' });
export function serverURL(value) {
  const u = new URL(value);
  if (!/^https?:$/.test(u.protocol) || u.username || u.password || u.hash || u.search) throw Error('请填写 HTTP(S) 知识库地址');
  return u.href.replace(/\/$/, '');
}
export async function api(config, path, options = {}) {
  if (!config.token) throw Error('请先填写 ZNote 写入令牌并连接');
  const r = await fetch(serverURL(config.server) + path, { ...options, credentials: 'omit', redirect: 'error', signal: options.signal || AbortSignal.timeout(60000), headers: { ...options.headers, Authorization: 'Bearer ' + config.token } });
  let data; try { data = await r.json(); } catch { throw Error('知识库未返回有效响应'); }
  if (!r.ok) throw Error(data.error || `知识库 HTTP ${r.status}`); return data;
}
export async function media(url, signal, max = 25 * 1024 * 1024) {
  const r = await fetch(pximg(url), { credentials: 'include', redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(45000)]) });
  if (!r.ok) throw Error(`读取原文件失败 HTTP ${r.status}，请确认 Pixiv 登录与网络`);
  if (Number(r.headers.get('content-length') || 0) > max) { await r.body.cancel(); throw Error('原文件超过本次入库大小限制'); }
  const reader = r.body.getReader(), parts = []; let size = 0;
  try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > max) throw Error('原文件超过本次入库大小限制'); parts.push(value); } }
  finally { await reader.cancel(); }
  return new Blob(parts, { type: r.headers.get('content-type') || 'application/octet-stream' });
}
export function description(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,style,iframe,object,form,img,video,audio').forEach(n => n.remove());
  doc.querySelectorAll('a').forEach(a => { try { const u = new URL(a.getAttribute('href'), 'https://www.pixiv.net'); if (!/^https?:$/.test(u.protocol)) a.removeAttribute('href'); else a.setAttribute('href', u.href); } catch { a.removeAttribute('href'); } });
  return markdown.turndown(doc.body.innerHTML);
}
const mdText = s => String(s || '').replace(/[\\[\]]/g, '\\$&');
export function details(record, target) {
  // Reserve the author before optional tags so the 30-tag cap never drops it.
  // Keep the complete display name and stable author ID in the note below.
  const authorTag = String(record.author || '').trim().slice(0, 40).replace(/[\uD800-\uDBFF]$/, '');
  const tags = [...new Set(['Pixiv', ...(authorTag ? [authorTag] : []), ...target.tags.split(/[,，]/).map(t => t.trim()).filter(Boolean), ...(target.includeTags ? record.tags : [])])];
  const fields = {
    title: `${record.title || record.id}${record.type < 2 ? ' · ' + String(record.index + 1).padStart(3, '0') : ''}`.slice(0,200),
    collection_id: target.collection_id || null, tags: tags.filter(t => t.length <= 40).slice(0,30), source_url: record.source,
    captured_at: new Date().toISOString(),
    ...(target.groupMode && record.type < 2 ? {group_key:target.groupMode === 'work' ? `pixiv:art:${record.id}` : '',group_index:record.index,group_title:record.title} : {}),
    content: [record.authorId ? `作者：[${mdText(record.author || record.authorId)}](https://www.pixiv.net/users/${record.authorId})` : `作者：${record.author || '未知'}`, description(record.description)].filter(Boolean).join('\n\n'),
  };
  return fields;
}
export async function upload(config, blob, fields, filename) {
  if (blob.size > 25 * 1024 * 1024) throw Error('单张图片超过知识库 25 MB 限制');
  const data = new FormData(); data.set('file', blob, filename);
  for (const [k,v] of Object.entries(fields)) if (v !== null) data.set(k, k === 'tags' ? JSON.stringify(v) : v);
  return api(config, '/api/assets', { method: 'POST', body: data });
}
export async function novelBody(record, saveImage, signal) {
  let text = record.novel.replace(/\[newpage\]/g, '\n\n---\n\n').replace(/\[chapter:([^\]]+)\]/g, '\n\n## $1\n\n')
    .replace(/\[\[rb:([^>]+)>([^\]]+)\]\]/g, '$1（$2）')
    .replace(/\[\[jumpuri:([^>]+)>(https?:\/\/[^\]]+)\]\]/g, (_, title, url) => `[${mdText(title)}](<${url.replace(/[<>]/g,'')}>)`);
  const images = [];
  if (record.cover) images.push(['cover', record.cover]);
  for (const match of text.matchAll(/\[uploadedimage:(\d+)\]/g)) {
    const url = record.embedded?.[match[1]]; if (!url) throw Error('小说内嵌图片地址缺失，请重新抓取');
    images.push([match[0], url]);
  }
  // Referenced artwork images resolve via the logged-in Pixiv browser session.
  for (const match of text.matchAll(/\[pixivimage:(\d+)(?:-(\d+))?\]/g)) {
    const r = await fetch(`https://www.pixiv.net/ajax/illust/${match[1]}/pages`, { credentials: 'include', signal });
    if (!r.ok) throw Error('小说引用插画不可访问'); const data = await r.json();
    const url = data.body?.[Math.max(0, Number(match[2] || 1) - 1)]?.urls?.original;
    images.push([match[0], pximg(url)]);
  }
  const saved = new Map();
  for (const [marker, url] of images) {
    signal.throwIfAborted();
    let id = saved.get(url); if (!id) { id = (await saveImage(await media(url, signal), url)).id; saved.set(url, id); }
    const image = `![${marker === 'cover' ? '封面' : '小说配图'}](/media/${id}/original)`;
    if (marker === 'cover') text = image + '\n\n' + text; else text = text.split(marker).join(image);
  }
  return text;
}
