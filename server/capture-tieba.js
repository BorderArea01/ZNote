import {createHash} from 'node:crypto';

const fail = message => Object.assign(Error(message), {status:422});
const MAX_PAGES = 20, MAX_IMAGES = 200;
const identifier = value => typeof value === 'number' && !Number.isSafeInteger(value) ? '' : /^\d+$/.test(String(value ?? '')) ? String(value) : '';

export function tiebaThread(value) {
  try {
    const url = new URL(value), id = url.pathname.match(/^\/p\/([1-9]\d{0,19})\/?$/)?.[1];
    if (!id || url.hostname !== 'tieba.baidu.com' || !/^https?:$/.test(url.protocol) || url.username || url.password || url.port) return null;
    return {id, url:`https://tieba.baidu.com/p/${id}`};
  } catch { return null; }
}

// Public read-only client endpoint. These protocol fields are not account
// credentials. No browser cookies, device identifiers or login data are sent.
export function tiebaPageRequest(id, page) {
  const params = {_client_id:'wappc_1534235498291_633', _client_type:'2', _client_version:'9.7.8.0', _phone_imei:'000000000000000', kz:id, lz:'1', pn:String(page), r:'0', rn:'30', st:'0', z:'0'};
  const sign = createHash('md5').update(Object.keys(params).sort().map(key => `${key}=${params[key]}`).join('') + 'tiebaclient!!!').digest('hex').toUpperCase();
  return {url:'https://c.tieba.baidu.com/c/f/pb/page', body:new URLSearchParams({...params, sign}).toString(), userAgent:'bdtb for Android 9.7.8.0'};
}

function imageUrl(value) {
  if (typeof value !== 'string' || !value || value.length > 4096) return '';
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.port || !/^(?:tiebapic|imgsrc|imgsa)\.baidu\.com$/.test(url.hostname) || !url.pathname.startsWith('/forum/') || !/\.(?:jpe?g|png|gif|webp|avif)$/i.test(url.pathname)) return '';
    // This CDN supports HTTPS for both original and display variants. Keep
    // the full signed path/query; never invent an unsigned original address.
    url.protocol = 'https:';
    url.hash = '';
    return url.href;
  } catch { return ''; }
}

function text(value) { return typeof value === 'string' ? value.replace(/\r\n?/g, '\n') : ''; }
function plain(value) { return text(value).replace(/([\\`*_{}\[\]<>#!|])/g, '\\$1'); }

export function extractTiebaPages(pages, source) {
  const thread = tiebaThread(source);
  if (!thread) throw fail('贴吧帖子链接无效');
  if (!Array.isArray(pages) || !pages.length || pages.length > MAX_PAGES) throw fail('贴吧楼主内容不完整，未按完整帖子入库');
  const first = pages[0], authorId = identifier(first?.thread?.author?.id);
  if (!authorId) throw fail('贴吧没有提供楼主身份，未混入其他回复');
  const posts = new Map();
  for (const [index, page] of pages.entries()) {
    validatePage(page, thread.id, index + 1);
    if (Number(page.page.total_page) !== Number(first.page.total_page)) throw fail('贴吧楼主分页发生变化，请重试');
    if (identifier(page.thread.author?.id) !== authorId) throw fail('贴吧楼主信息发生变化，请重试');
    for (const post of page.post_list) {
      // lz=1 asks the server for OP posts, but identity must still be checked.
      if (identifier(post.author_id) !== authorId) continue;
      const id = identifier(post.id), floor = Number(post.floor);
      if (!id || !Number.isInteger(floor) || floor < 1 || !Array.isArray(post.content)) throw fail('贴吧楼主楼层数据不完整，请重试');
      if (posts.has(id)) throw fail('贴吧返回了重复分页，请重试');
      posts.set(id, post);
    }
  }
  const total = Number(first.page.total_page);
  if (pages.length !== total) throw fail('贴吧楼主内容还有未读取的分页，未按完整帖子入库');
  if (!posts.size || ![...posts.values()].some(post => Number(post.floor) === 1)) throw fail('贴吧未提供楼主首帖，可能需要平台验证或帖子不可访问');
  const title = text(first.thread.title).trim().slice(0, 200) || '贴吧帖子';
  const author = text(first.thread.author.name_show || first.thread.author.name).trim().slice(0, 200);
  const forum = text(first.forum?.name || first.thread.fname || first.display_forum?.name).trim().slice(0, 200);
  const images = [], image_candidates = [], seen = new Set(), sections = [];
  for (const post of [...posts.values()].sort((a,b) => Number(a.floor) - Number(b.floor))) {
    const parts = [];
    for (const item of post.content) {
      if (!item || typeof item !== 'object') continue;
      if (Number(item.type) === 3) {
        const candidates = [...new Set([item.origin_src, item.big_cdn_src, item.cdn_src].map(imageUrl).filter(Boolean))];
        if (!candidates.length) throw fail('贴吧有无法读取的楼主配图，未按完整图组入库');
        // Signed URLs may differ across floors while referring to the same
        // picture. Tieba's picture ID is the final filename, not its signature.
        const key = new URL(candidates[0]).pathname.split('/').at(-1);
        if (!seen.has(key)) { seen.add(key); images.push(candidates[0]); image_candidates.push(candidates); }
        if (images.length > MAX_IMAGES) throw fail('贴吧楼主配图超过 200 张，请分段采集');
      } else if (Number(item.type) === 2) {
        parts.push(`[表情：${plain(item.c || item.text || '表情')}]`);
      } else if (Number(item.type) === 9) {
        throw fail('这篇贴吧帖子包含视频，当前贴吧适配只采集图片和正文，未仅保存视频封面');
      } else {
        // Keep the supplied text without treating links/images embedded in
        // user text as extra media to download.
        parts.push(plain(item.text || item.link || ''));
      }
    }
    const body = parts.join('').trim();
    if (body) sections.push(`### 楼主 · ${Number(post.floor)} 楼\n\n${body}`);
  }
  const content = [author && `作者：${plain(author)}`, forum && `贴吧：${plain(forum)}`, `来源：${thread.url}`, ...sections].filter(Boolean).join('\n\n');
  if (content.length > 450000) throw fail('贴吧楼主正文过长，未入库');
  return {kind:'note', default_image_mode:'group', url:thread.url, title, author, tags:['百度贴吧', ...(forum ? [forum.slice(0,40)] : [])], content, images, image_candidates};
}

function validatePage(data, id, page) {
  if (!data || Number(data.error_code) !== 0 || !data.thread || !Array.isArray(data.post_list)) throw fail('贴吧未提供帖子数据，可能需要平台验证或帖子不可访问；任务可重试');
  if (identifier(data.thread.id) !== id) throw fail('贴吧返回了其他帖子的数据，未采集');
  const current = Number(data.page?.current_page), total = Number(data.page?.total_page);
  if (current !== page || !Number.isInteger(total) || total < page || total > MAX_PAGES || data.post_list.length > 30) throw fail(`贴吧分页数据不完整或楼主内容超过 ${MAX_PAGES} 页，未按完整帖子入库`);
  if (current === total && Number(data.page?.has_more) === 1) throw fail('贴吧仍有未提供的楼主分页，未按完整帖子入库');
}

export async function fetchTiebaPlan(value, signal, read, options = {}) {
  const thread = tiebaThread(value);
  if (!thread) throw fail('贴吧帖子链接无效');
  const pages = [];
  let total = 1, bytes = 0;
  for (let page = 1; page <= total; page++) {
    signal.throwIfAborted();
    options.progress?.(`正在读取贴吧楼主内容 ${page}/${total} 页`);
    const request = tiebaPageRequest(thread.id, page);
    // Tieba labels its JSON as application/x-javascript. This branch only
    // parses JSON; it never evaluates the response as JavaScript.
    const resource = await read(request.url, signal, 0, {json:true, jsonJavascript:true, accept:'application/json', userAgent:request.userAgent, body:request.body});
    signal.throwIfAborted();
    bytes += resource.buffer.length;
    if (bytes > 8 * 1024 * 1024) throw fail('贴吧楼主内容超过采集数据上限，请分段采集');
    let data;
    try { data = JSON.parse(resource.buffer.toString('utf8')); } catch { throw fail('贴吧返回了验证页面，未取得帖子数据；任务可重试'); }
    validatePage(data, thread.id, page);
    if (page === 1) total = Number(data.page.total_page);
    else if (Number(data.page.total_page) !== total) throw fail('贴吧楼主分页发生变化，请重试');
    pages.push(data);
  }
  return {url:thread.url, type:'application/x-znote-capture-plan', buffer:Buffer.from(''), plan:extractTiebaPages(pages, thread.url)};
}
