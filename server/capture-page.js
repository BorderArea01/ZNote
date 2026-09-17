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
const fail = message => Object.assign(Error(message), { status: 422 });
const absolute = (v, base) => { try { const u = new URL(v, base); return /^https?:$/.test(u.protocol) && !u.username && !u.password ? u.href : ''; } catch { return ''; } };
export async function fetchCapturePage(value, signal, redirects = 0) {
  const url = new URL(value), host = url.hostname.replace(/^\[|\]$/g, '');
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.port && !['80','443'].includes(url.port)) throw fail('仅支持公开网页的 HTTP(S) 链接');
  signal.throwIfAborted();
  const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await lookup(host, { all: true });
  if (!addresses.length || addresses.some(v => !publicAddress(v.address))) throw fail('不能采集本机或内网地址');
  signal.throwIfAborted();
  const target = addresses[0];
  return new Promise((resolve, reject) => {
    const req = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
      signal, headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/131.0.0.0 Mobile Safari/537.36', Accept: 'text/html,image/*', 'Accept-Encoding': 'identity' },
      lookup: (_host, options, cb) => options.all ? cb(null, [target]) : cb(null, target.address, target.family),
    }, res => {
      if ([301,302,303,307,308].includes(res.statusCode)) {
        res.resume();
        if (redirects >= 5 || !res.headers.location) return reject(fail('分享链接跳转过多'));
        fetchCapturePage(new URL(res.headers.location, url).href, signal, redirects + 1).then(resolve, reject); return;
      }
      if (res.statusCode !== 200) { res.resume(); reject(fail(`页面无法读取（HTTP ${res.statusCode}），可能需要登录或验证`)); return; }
      const type = res.headers['content-type'] || '', limit = type.startsWith('image/') ? MAX_IMAGE_BYTES : 8 * 1024 * 1024;
      if (type && !/^(text\/html|application\/xhtml\+xml|image\/)/i.test(type)) { res.destroy(); reject(fail('链接没有返回网页或图片')); return; }
      if (Number(res.headers['content-length']) > limit) { res.destroy(); reject(fail('页面或图片超过采集大小上限')); return; }
      const chunks = []; let size = 0;
      res.on('data', chunk => { size += chunk.length; if (size > limit) { res.destroy(); reject(fail('页面或图片超过采集大小上限')); } else chunks.push(chunk); });
      res.on('end', () => resolve({ url: url.href, type, buffer: Buffer.concat(chunks) })); res.on('error', reject);
    });
    const timer = setTimeout(() => req.destroy(fail('网页读取超时，请重试')), 20000);
    req.on('close', () => clearTimeout(timer)); req.on('error', reject); req.end();
  });
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
    if (platform === 'xhs' && String(v.noteId || v.note_id || '') === id && (Array.isArray(v.imageList) || v.type === 'video')) return v;
    if (platform === 'douyin' && String(v.aweme_id || v.awemeId || '') === id && (v.desc !== undefined || v.author || v.images || v.image_list || v.image_post_info)) return v;
    for (const child of Object.values(v)) if (child && typeof child === 'object') stack.push(child);
  }
  return null;
}
const values = value => typeof value === 'string' ? [value] : Array.isArray(value) ? value.filter(v => typeof v === 'string') : [];
function liveVideoCandidates(image, base) {
  const video=image?.video||image?.live_photo?.video||image?.livePhoto?.video||image?.motion_video||image?.motionVideo;
  if(!video)return [];
  const addresses=[video.play_addr,video.playAddr,video.play_addr_h264,video.playAddrH264,video.download_addr,video.downloadAddr,video];
  const found=[];
  for(const address of addresses){
    if(!address)continue;
    for(const raw of [...values(address.url_list),...values(address.urlList),...values(address.url),...values(address.play_url),...values(address.playUrl),...values(address.download_url),...values(address.downloadUrl)]){
      const url=absolute(raw,base);if(url)found.push(url);
    }
  }
  return [...new Set(found)].slice(0,8);
}
export function extractCapturePage(html, url) {
  const { document } = parseHTML(html), u = new URL(url), host = u.hostname;
  const meta = name => document.querySelector(`meta[property="${name}"],meta[name="${name}"]`)?.getAttribute('content') || '';
  const xhs = /(^|\.)xiaohongshu\.com$/.test(host), dy = /(^|\.)(douyin|iesdouyin)\.com$/.test(host);
  const id = xhs ? u.pathname.match(/\/(?:explore|discovery\/item)\/([a-f\d]+)/i)?.[1] : u.pathname.match(/\/(?:video|note|slides)\/(\d+)/)?.[1] || u.searchParams.get('modal_id');
  if (xhs || dy) {
    for (const script of [...document.querySelectorAll('script:not([src])')].slice(0,150).sort((a,b)=>Number(b.textContent.includes('window.__SETUP_SERVER_STATE__='))-Number(a.textContent.includes('window.__SETUP_SERVER_STATE__=')))) {
      let raw = script.textContent;
      if (script.id === 'RENDER_DATA') { try { raw = decodeURIComponent(raw); } catch { continue; } }
      const record = id && scriptValues(raw).map(data=>findRecord(data, id, xhs ? 'xhs' : 'douyin')).find(Boolean);
      if (!record) continue;
      const galleryImages=xhs ? record.imageList || [] : record.images || record.image_list || record.image_post_info?.images || record.image_post_info?.image_list || [];
      if (xhs && record.type === 'video' || dy && !galleryImages.length) {
        const streams=xhs?record.video?.media?.stream?.h264||[]:[];
        const candidates=xhs?[...streams].sort((a,b)=>(b.width*b.height-a.width*a.height)||(b.videoBitrate-a.videoBitrate)).flatMap(s=>[s.masterUrl,...(s.backupUrls||[])]):record.video?.play_addr?.url_list||[];
        return { kind:'video',url,title:record.title||record.desc?.split('\n')[0]||'',author:record.user?.nickname||record.user?.nickName||record.author?.nickname||'',description:record.desc||'',video_urls:[...new Set(candidates.map(v=>absolute(v,url)).filter(Boolean))].slice(0,8) };
      }
      const images = galleryImages.map(i => captureImageCandidates(i, xhs ? 'xhs' : 'douyin', url));
      if (!images.length || images.length > 100) throw fail('未取得完整图集或图集超过 100 张');
      const urls = images.map(v => v[0]);
      if (urls.some(v => !v)) throw fail('图集中有无法解析的图片地址');
      const live_videos=xhs?[]:galleryImages.map((image,index)=>({index,urls:liveVideoCandidates(image,url)})).filter(v=>v.urls.length);
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
