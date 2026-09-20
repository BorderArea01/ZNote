import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { parseHTML } from 'linkedom';
import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import { publicAddress } from './remote-images.js';
import { captureImageCandidates } from './capture-images.js';
import { MAX_IMAGE_BYTES } from './image-limits.js';
import { proxyAgent } from './network-proxy.js';
const fail = message => Object.assign(Error(message), { status: 422 });
const absolute = (v, base) => { try { const u = new URL(v, base); return /^https?:$/.test(u.protocol) && !u.username && !u.password ? u.href : ''; } catch { return ''; } };
const EH_HOST = /^(?:www\.)?(?:e-hentai|exhentai)\.org$/i;
const PIXIV_HOST = /^(?:www\.)?pixiv\.net$/i;

async function fetchDocument(value, signal, redirects = 0, extra = {}) {
  const url = new URL(value), host = url.hostname.replace(/^\[|\]$/g, '');
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.port && !['80','443'].includes(url.port)) throw fail('仅支持公开网页的 HTTP(S) 链接');
  signal.throwIfAborted();
  const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await lookup(host, { all: true });
  if (!addresses.length || addresses.some(v => !publicAddress(v.address))) throw fail('不能采集本机或内网地址');
  signal.throwIfAborted();
  const target = addresses[0];
  return new Promise((resolve, reject) => {
    const agent = proxyAgent();
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/131.0.0.0 Mobile Safari/537.36',
      Accept: extra.accept || 'text/html,image/*',
      'Accept-Encoding': 'identity',
      ...(extra.referer ? { Referer: extra.referer } : {}),
    };
    const options = { signal, headers, ...(agent ? { agent } : { lookup: (_host, lookupOptions, cb) => lookupOptions.all ? cb(null, [target]) : cb(null, target.address, target.family) }) };
    const req = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, options, res => {
      if ([301,302,303,307,308].includes(res.statusCode)) {
        res.resume();
        if (redirects >= 5 || !res.headers.location) return reject(fail('分享链接跳转过多'));
        fetchDocument(new URL(res.headers.location, url).href, signal, redirects + 1, extra).then(resolve, reject); return;
      }
      if (res.statusCode !== 200) { res.resume(); reject(fail(`页面无法读取（HTTP ${res.statusCode}），可能需要登录或验证`)); return; }
      const type = res.headers['content-type'] || '', limit = type.startsWith('image/') ? MAX_IMAGE_BYTES : 8 * 1024 * 1024;
      if (type && !(extra.json ? /^(application\/json|text\/json|text\/plain)/i.test(type) : /^(text\/html|application\/xhtml\+xml|image\/)/i.test(type))) { res.destroy(); reject(fail('链接没有返回网页或图片')); return; }
      if (Number(res.headers['content-length']) > limit) { res.destroy(); reject(fail('页面或图片超过采集大小上限')); return; }
      const chunks = []; let size = 0;
      res.on('data', chunk => { size += chunk.length; if (size > limit) { res.destroy(); reject(fail('页面或图片超过采集大小上限')); } else chunks.push(chunk); });
      res.on('end', () => resolve({ url: url.href, type, buffer: Buffer.concat(chunks) })); res.on('error', reject);
    });
    const timer = setTimeout(() => req.destroy(fail('网页读取超时，请重试')), 20000);
    req.on('close', () => clearTimeout(timer)); req.on('error', reject); req.end();
  });
}

export async function fetchCapturePage(value, signal, redirects = 0) {
  const url = new URL(value);
  if (PIXIV_HOST.test(url.hostname) && /^\/(?:[a-z]{2}\/)?artworks\/\d+\/?$/i.test(url.pathname)) return fetchPixivPlan(url, signal);
  const resource = await fetchDocument(value, signal, redirects);
  if (EH_HOST.test(url.hostname) && /^\/g\/\d+\/[a-z0-9]+\/?$/i.test(url.pathname)) return expandEHentai(resource, signal);
  return resource;
}

function pageUrl(value, base, pattern) {
  try {
    const url = new URL(value, base);
    return url.protocol === 'https:' && EH_HOST.test(url.hostname) && pattern.test(url.pathname) && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}

function ehGalleryPage(html, url) {
  const { document } = parseHTML(html), title = document.querySelector('#gn')?.textContent?.trim() || document.title || 'E-Hentai 图集';
  const pageLinks = [...document.querySelectorAll('#gdt a[href]')].map(anchor => {
    const href = pageUrl(anchor.getAttribute('href'), url, /^\/s\/[a-z0-9]+\/\d+-\d+$/i);
    const index = Number(href.match(/-(\d+)$/)?.[1]);
    return href && Number.isInteger(index) ? { href, index } : null;
  }).filter(Boolean);
  const total = Number(document.querySelector('.gpc')?.textContent?.match(/of\s+(\d+)\s+images?/i)?.[1] || 0);
  const tags = [...document.querySelectorAll('#taglist a')].map(node => node.textContent?.trim()).filter(Boolean);
  const uploader = document.querySelector('#gdn a')?.textContent?.trim() || '';
  return { title, pageLinks, total, tags, uploader };
}

function ehImagePage(html, url) {
  const { document } = parseHTML(html), image = document.querySelector('#img'), display = absolute(image?.getAttribute('src') || '', url);
  const original = [...document.querySelectorAll('#i6 a[href]')].map(node => absolute(node.getAttribute('href') || '', url)).find(value => /\/fullimg\/\d+\/\d+\//.test(value)) || '';
  const index = Number(url.match(/-(\d+)$/)?.[1]);
  return { index, candidates: [...new Set([display, original].filter(Boolean))] };
}

async function expandEHentai(resource, signal) {
  const galleryUrl = resource.url, first = ehGalleryPage(resource.buffer.toString('utf8'), galleryUrl);
  if (!first.pageLinks.length) throw fail('E-Hentai 图集页面没有可读取的图片，可能需要登录或验证');
  if (first.total > 200) throw fail('E-Hentai 图集超过 200 张，请分段采集');
  const total = Math.min(first.total || first.pageLinks.length, 200), pageCount = Math.max(1, Math.ceil(total / 20));
  const galleryPages = [galleryUrl, ...Array.from({ length: pageCount - 1 }, (_, index) => {
    const next = new URL(galleryUrl); next.searchParams.set('p', String(index + 1)); return next.href;
  })];
  const pageResources = [resource];
  for (let index = 1; index < galleryPages.length; index++) {
    signal.throwIfAborted();
    pageResources.push(await fetchDocument(galleryPages[index], signal, 0, { referer: galleryUrl }));
  }
  const pageLinks = new Map();
  for (const page of pageResources) for (const entry of ehGalleryPage(page.buffer.toString('utf8'), page.url).pageLinks) pageLinks.set(entry.index, entry.href);
  const ordered = [...pageLinks.entries()].sort((a, b) => a[0] - b[0]).slice(0, total || 200);
  const imagePages = [];
  // Four concurrent page reads keep an entire 200-page gallery from opening a
  // large socket burst while avoiding the serial delay of image-page loading.
  for (let offset = 0; offset < ordered.length; offset += 4) {
    signal.throwIfAborted();
    const batch = await Promise.all(ordered.slice(offset, offset + 4).map(([, href]) => fetchDocument(href, signal, 0, { referer: galleryUrl })));
    imagePages.push(...batch.map((page, batchIndex) => ({ page, index: ordered[offset + batchIndex][0] })));
  }
  const images = imagePages.sort((a, b) => a.index - b.index).map(({ page, index }) => {
    const parsed = ehImagePage(page.buffer.toString('utf8'), page.url);
    return { index, candidates: parsed.candidates };
  }).filter(entry => entry.candidates.length);
  if (!images.length) throw fail('E-Hentai 未返回可下载的图片地址，可能需要登录或验证');
  if (total && images.length < total) throw fail(`E-Hentai 只返回了 ${images.length}/${total} 张图片，请登录后重试`);
  const plan = {
    kind: 'note', url: galleryUrl, title: first.title.slice(0, 200),
    content: [first.uploader ? `上传者：${first.uploader}` : '', first.tags.length ? `标签：${first.tags.join(', ')}` : ''].filter(Boolean).join('\n\n'),
    images: images.map(entry => entry.candidates[0]),
    image_candidates: images.map(entry => entry.candidates),
    author: first.uploader,
    tags: first.tags,
  };
  return { url: galleryUrl, type: 'application/x-znote-capture-plan', buffer: Buffer.from(''), plan };
}

async function fetchPixivJson(url, signal, referer) {
  const resource = await fetchDocument(url, signal, 0, { json: true, referer });
  try { return JSON.parse(resource.buffer.toString('utf8')); } catch { throw fail('Pixiv 返回了无法读取的数据，可能需要验证'); }
}

async function fetchPixivPlan(url, signal) {
  const id = url.pathname.match(/\/artworks\/(\d+)/)?.[1];
  if (!id) throw fail('请提供 Pixiv 单个作品详情链接');
  const referer = `https://www.pixiv.net/artworks/${id}`;
  const [info, pages] = await Promise.all([
    fetchPixivJson(`https://www.pixiv.net/ajax/illust/${id}`, signal, referer),
    fetchPixivJson(`https://www.pixiv.net/ajax/illust/${id}/pages`, signal, referer),
  ]);
  const body = info?.body, rows = pages?.body;
  if (info?.error || !body || !Array.isArray(rows) || !rows.length) throw fail(info?.message || 'Pixiv 作品不可访问，可能需要登录或验证');
  if (Number(body.pageCount || rows.length) > rows.length || rows.length > 200) throw fail('Pixiv 作品页数超出本次支持范围（1～200 张）');
  const candidates = rows.map(row => [row?.urls?.original, row?.urls?.regular, row?.urls?.small].map(value => absolute(value, referer)).filter(Boolean));
  if (candidates.some(row => !row.length)) throw fail('Pixiv 未返回完整的作品图片地址');
  const tags = Array.isArray(body.tags?.tags) ? body.tags.tags.map(tag => tag?.translated_name || tag?.tag).filter(Boolean) : [];
  const description = String(body.description || '').replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]+>/g, '').trim();
  return { url: referer, type: 'application/x-znote-capture-plan', buffer: Buffer.from(''), plan: {
    kind: 'note', url: referer, title: String(body.title || 'Pixiv 作品').slice(0, 200), content: description,
    images: candidates.map(row => row[0]), image_candidates: candidates,
    author: String(body.userName || body.userId || ''), tags,
  } };
}

function extractPawCapture(html, url) {
  const { document } = parseHTML(html), main = document.querySelector('main');
  if (!main) throw fail('Paw 作品正文尚未加载，请先打开单篇作品页面');
  const isOriginal = value => {
    try {
      const candidate = new URL(value, url);
      return /^https?:$/.test(candidate.protocol) && /^file\.pawchive\.(?:pw|st)$/i.test(candidate.hostname) && /\.(?:avif|bmp|gif|jpe?g|png|webp)$/i.test(candidate.searchParams.get('f') || candidate.pathname);
    } catch { return false; }
  };
  const images = [], seen = new Set();
  for (const anchor of main.querySelectorAll('figure a[href],a.fileThumb[href]')) {
    const href = absolute(anchor.getAttribute('href') || '', url);
    if (!isOriginal(href) || seen.has(href)) continue;
    seen.add(href);
    const preview = absolute(anchor.querySelector('img')?.getAttribute('data-src') || anchor.querySelector('img')?.getAttribute('src') || '', url);
    images.push([href, preview].filter(Boolean));
  }
  if (!images.length) throw fail('Paw 作品没有找到套图原图链接，请确认已登录且作品已加载完成');
  const title = main.querySelector('h1')?.textContent?.trim() || document.querySelector('meta[property="og:title"]')?.getAttribute('content') || document.title || 'Paw 作品';
  const contentRoot = main.querySelector('.post__content');
  const content = contentRoot ? new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' }).turndown(contentRoot.innerHTML).trim() : '';
  const author = document.querySelector('meta[name="author"]')?.getAttribute('content') || main.querySelector('[data-author],.post__author a,.post-author a')?.textContent?.trim() || '';
  return { kind: 'note', url, title: title.slice(0, 200), content, images: images.map(value => value[0]), image_candidates: images, author };
}

// Parse only JSON data. Never execute platform scripts, even in a VM.
function scriptData(raw) {
  let value = raw.trim();
  const assignment = value.match(/(?:window|self|globalThis)\.(?:__INITIAL_STATE__|__SETUP_SERVER_STATE__|_ROUTER_DATA)\s*=\s*/);
  if (assignment) {
    value = value.slice(assignment.index + assignment[0].length);
    let depth = 0, quoted = false, escaped = false, output = '';
    for (let i = 0; i < value.length; i++) {
      const c = value[i];
      if (!quoted && value.slice(i, i + 9) === 'undefined') { output += 'null'; i += 8; continue; }
      output += c;
      if (quoted) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') quoted = false; }
      else if (c === '"') quoted = true;
      else if (c === '{' || c === '[') depth++;
      else if ((c === '}' || c === ']') && --depth === 0) break;
    }
    value = output;
  }
  try { return JSON.parse(value); } catch { return null; }
}
function scriptValues(raw) {
  const direct = scriptData(raw);
  if (direct) return [direct];
  // Douyin's current desktop detail page serializes the work in a React
  // Flight stream instead of RENDER_DATA or an aweme/detail XHR response.
  // Decode the JSON argument only; never execute the script.
  const match = raw.trim().match(/^self\.__pace_f\.push\((\[[\s\S]*\])\)\s*;?$/);
  if (!match || match[1].length > 8 * 1024 * 1024) return [];
  try {
    const outer = JSON.parse(match[1]), payload = outer[1];
    if (typeof payload !== 'string' || payload.length > 8 * 1024 * 1024) return [];
    const separator = payload.indexOf(':');
    if (separator < 0) return [];
    const value = payload.slice(separator + 1);
    if (!/^[\[{]/.test(value)) return [];
    return [JSON.parse(value)];
  } catch { return []; }
}
function findRecord(data, id, platform) {
  const stack = [data]; let count = 0;
  while (stack.length && count++ < 30000) {
    const v = stack.pop(); if (!v || typeof v !== 'object') continue;
    if (platform === 'xhs' && String(v.noteId || v.note_id || '') === id && (Array.isArray(v.imageList) || Array.isArray(v.image_list) || Array.isArray(v.noteCard?.imageList) || v.type === 'video')) return v;
    if (platform === 'douyin' && String(v.aweme_id || v.awemeId || '') === id && (v.desc !== undefined || v.author || v.images || v.image_list || v.image_post_info || v.imagePostInfo)) return v;
    for (const child of Object.values(v)) if (child && typeof child === 'object') stack.push(child);
  }
  return null;
}
const values = value => typeof value === 'string' ? [value] : Array.isArray(value) ? value.filter(v => typeof v === 'string') : [];
function mergeMediaEntries(...entries) {
  const result = {};
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    for (const [key, value] of Object.entries(entry)) {
      if (value === undefined || value === null || value === '') continue;
      const previous = result[key];
      if (previous && typeof previous === 'object' && !Array.isArray(previous) && typeof value === 'object' && !Array.isArray(value)) {
        result[key] = mergeMediaEntries(previous, value);
      } else if (Array.isArray(previous) && Array.isArray(value)) {
        // Keep the richer representation when one endpoint only contains a
        // cover URL while another contains the complete playback metadata.
        result[key] = value.length > previous.length ? value : previous;
      } else if (previous === undefined || previous === null || previous === '') {
        result[key] = value;
      }
    }
  }
  return result;
}
function galleryEntries(record, platform) {
  const sources = platform === 'xhs'
    ? [record.imageList, record.image_list, record.noteCard?.imageList, record.note_card?.image_list]
    : [record.images, record.image_list, record.image_post_info?.images, record.image_post_info?.image_list, record.imagePostInfo?.images, record.imagePostInfo?.imageList];
  const arrays = sources.filter(Array.isArray).filter(value => value.length);
  if (!arrays.length) return [];
  const length = Math.max(...arrays.map(value => value.length));
  const merged = Array.from({ length }, (_, index) => mergeMediaEntries(...arrays.map(value => value[index])));
  const seen = new Set();
  return merged.filter(entry => {
    const identity = [...values(entry?.urlDefault), ...values(entry?.url_default), ...values(entry?.urlList), ...values(entry?.url_list), ...values(entry?.origin_url)].find(Boolean) || JSON.stringify(entry);
    if (seen.has(identity)) return false;
    seen.add(identity); return true;
  });
}
function liveVideoCandidates(image, base) {
  const video=image?.video||image?.live_photo?.video||image?.livePhoto?.video||image?.motion_video||image?.motionVideo;
  if(!video)return [];
  const bitrateList=Array.isArray(video.bit_rate_list)?video.bit_rate_list:Array.isArray(video.bitRateList)?video.bitRateList:[];
  const bitrateAddresses=bitrateList.flatMap(rate=>[rate?.play_addr,rate?.playAddr]);
  const addresses=[video.play_addr,video.playAddr,video.play_addr_h264,video.playAddrH264,video.play_addr_h265,video.playAddrH265,video.download_addr,video.downloadAddr,...bitrateAddresses,video];
  const found=[];
  for(const address of addresses){
    if(!address)continue;
    found.push(...liveAddressUrls(address,base));
  }
  return [...new Set(found)].slice(0,8);
}
function xhsLiveVideoCandidates(image, base) {
  if (!(image?.livePhoto === true || image?.livePhoto === 1 || image?.live_photo === true || image?.live_photo === 1)) return [];
  const streams=image?.stream;
  if(!streams||typeof streams!=='object')return [];
  // Xiaohongshu exposes live-photo playback under image.stream.h264 rather
  // than a top-level video field. Prefer broadly playable H.264 variants,
  // then try the other advertised codecs if the primary CDN URL has expired.
  const rank=(a,b)=>{
    const pixels=v=>Number(v?.width||0)*Number(v?.height||0);
    return pixels(b)-pixels(a)||Number(b?.videoBitrate||0)-Number(a?.videoBitrate||0);
  };
  const variants=['h264','h265','h266','av1'].flatMap(codec=>{
    const value=streams[codec],items=Array.isArray(value)?value:value&&typeof value==='object'?[value]:[];
    return items.slice().sort(rank);
  });
  const found=variants.flatMap(stream=>[stream?.masterUrl, ...values(stream?.backupUrls)])
    .map(value=>absolute(value,base)).filter(Boolean);
  return [...new Set(found)].slice(0,8);
}
function liveAddressUrls(value,base,depth=0){
  if(depth>5||value==null)return [];
  if(typeof value==='string'){const url=absolute(value,base);return url?[url]:[];}
  if(Array.isArray(value))return value.flatMap(item=>liveAddressUrls(item,base,depth+1));
  if(typeof value!=='object')return [];
  // New Douyin image posts put motion-video CDN URLs in video.playAddr as
  // [{ src: "https://..." }], unlike the older url_list representation.
  // Follow only known playback/address keys so cover and image URLs cannot be
  // mistaken for the live-photo video.
  return ['src','url','url_list','urlList','play_addr','playAddr','play_addr_h264','playAddrH264','play_addr_h265','playAddrH265','download_addr','downloadAddr','play_url','playUrl','download_url','downloadUrl']
    .flatMap(key=>liveAddressUrls(value[key],base,depth+1));
}
export function extractCapturePage(html, url) {
  const { document } = parseHTML(html), u = new URL(url), host = u.hostname;
  const meta = name => document.querySelector(`meta[property="${name}"],meta[name="${name}"]`)?.getAttribute('content') || '';
  const xhs = /(^|\.)xiaohongshu\.com$/.test(host), dy = /(^|\.)(douyin|iesdouyin)\.com$/.test(host);
  if (/^pawchive\.(?:pw|st)$/i.test(host) && /^\/(?:fanbox|patreon)\/user\/[^/]+\/post\/[^/]+\/?$/i.test(u.pathname)) return extractPawCapture(html, url);
  const id = xhs ? u.pathname.match(/\/(?:explore|discovery\/item)\/([a-f\d]+)/i)?.[1] : u.pathname.match(/\/(?:video|note|slides)\/(\d+)/)?.[1] || u.searchParams.get('modal_id');
  if (xhs || dy) {
    for (const script of [...document.querySelectorAll('script:not([src])')].slice(0,150).sort((a,b)=>Number(b.textContent.includes('window.__SETUP_SERVER_STATE__='))-Number(a.textContent.includes('window.__SETUP_SERVER_STATE__=')))) {
      let raw = script.textContent;
      if (script.id === 'RENDER_DATA') { try { raw = decodeURIComponent(raw); } catch { continue; } }
      const record = id && scriptValues(raw).map(data=>findRecord(data, id, xhs ? 'xhs' : 'douyin')).find(Boolean);
      if (!record) continue;
      const galleryImages=galleryEntries(record, xhs ? 'xhs' : 'douyin');
      if (xhs && record.type === 'video' || dy && !galleryImages.length) {
        const streams=xhs?record.video?.media?.stream?.h264||[]:[];
        const candidates=xhs?[...streams].sort((a,b)=>(b.width*b.height-a.width*a.height)||(b.videoBitrate-a.videoBitrate)).flatMap(s=>[s.masterUrl,...(s.backupUrls||[])]):record.video?.play_addr?.url_list||[];
        return { kind:'video',url,title:record.title||record.desc?.split('\n')[0]||'',author:record.user?.nickname||record.user?.nickName||record.author?.nickname||record.authorInfo?.nickname||'',description:record.desc||'',video_urls:[...new Set(candidates.map(v=>absolute(v,url)).filter(Boolean))].slice(0,8) };
      }
      const images = galleryImages.map(i => captureImageCandidates(i, xhs ? 'xhs' : 'douyin', url));
      if (!images.length || images.length > 100) throw fail('未取得完整图集或图集超过 100 张');
      const urls = images.map(v => v[0]);
      if (urls.some(v => !v)) throw fail('图集中有无法解析的图片地址');
      const live_videos=galleryImages.map((image,index)=>({index,urls:xhs?xhsLiveVideoCandidates(image,url):liveVideoCandidates(image,url)})).filter(v=>v.urls.length);
      return { kind: 'note', url, title: record.title || record.desc?.split('\n')[0] || '手机采集', content: record.desc || '', images: urls, image_candidates: images, live_videos, author: record.user?.nickname || record.user?.nickName || record.author?.nickname || record.authorInfo?.nickname || '' };
    }
    // Do not archive login screens or unrelated recommendation thumbnails.
    if (dy && !/\/note\//.test(u.pathname) || /video/i.test(meta('og:type'))) return { kind: 'video', url };
    throw fail('平台未提供这篇作品的完整数据，可能需要登录或验证；可从原 App 直接分享图片，或用浏览器扩展采集');
  }
  if (/(^|\.)(bilibili\.com|b23\.tv|x\.com|twitter\.com)$/.test(host)) return { kind: 'video', url };
  const title = meta('og:title') || document.title || '网页采集', author = meta('author');
  for (const node of document.querySelectorAll('script,style,noscript,iframe,form,nav,footer,header,svg')) node.remove();
  for (const image of document.querySelectorAll('img')) {
    const src = absolute(image.getAttribute('data-original') || image.getAttribute('data-src') || image.getAttribute('src') || '', url);
    if (src) image.setAttribute('src', src); else image.remove();
    image.removeAttribute('srcset');
  }
  for (const a of document.querySelectorAll('a')) { const href = absolute(a.getAttribute('href') || '', url); if (href) a.setAttribute('href', href); else a.removeAttribute('href'); }
  let article; try { article = new Readability(document.cloneNode(true)).parse(); } catch {}
  const content = article?.content || document.querySelector('article,main')?.innerHTML;
  if (!content) throw fail('没有找到可保存的正文，页面可能需要登录或由 App 动态加载');
  const converter = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' }); converter.use(gfm);
  const markdown = converter.turndown(content);
  if (!markdown.trim()) throw fail('没有可保存的正文');
  return { kind: 'note', url, title: article?.title || title, content: markdown, author: article?.byline || author };
}
