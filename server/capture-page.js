import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { parseHTML } from 'linkedom';
import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import { publicAddress } from './remote-images.js';
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
      const type = res.headers['content-type'] || '', limit = type.startsWith('image/') ? 25 * 1024 * 1024 : 8 * 1024 * 1024;
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
  const assignment = value.match(/(?:window|self|globalThis)\.(?:__INITIAL_STATE__|_ROUTER_DATA)\s*=\s*/);
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
function findRecord(data, id, platform) {
  const stack = [data]; let count = 0;
  while (stack.length && count++ < 30000) {
    const v = stack.pop(); if (!v || typeof v !== 'object') continue;
    if (platform === 'xhs' && String(v.noteId || v.note_id || '') === id && (Array.isArray(v.imageList) || v.type === 'video')) return v;
    if (platform === 'douyin' && String(v.aweme_id || v.awemeId || '') === id && (v.desc !== undefined || v.author)) return v;
    for (const child of Object.values(v)) if (child && typeof child === 'object') stack.push(child);
  }
  return null;
}
export function extractCapturePage(html, url) {
  const { document } = parseHTML(html), u = new URL(url), host = u.hostname;
  const meta = name => document.querySelector(`meta[property="${name}"],meta[name="${name}"]`)?.getAttribute('content') || '';
  const xhs = /(^|\.)xiaohongshu\.com$/.test(host), dy = /(^|\.)(douyin|iesdouyin)\.com$/.test(host);
  const id = xhs ? u.pathname.match(/\/(?:explore|discovery\/item)\/([a-f\d]+)/i)?.[1] : u.pathname.match(/\/(?:video|note)\/(\d+)/)?.[1] || u.searchParams.get('modal_id');
  if (xhs || dy) {
    for (const script of [...document.querySelectorAll('script:not([src])')].slice(0,150)) {
      let raw = script.textContent;
      if (script.id === 'RENDER_DATA') { try { raw = decodeURIComponent(raw); } catch { continue; } }
      const record = id && findRecord(scriptData(raw), id, xhs ? 'xhs' : 'douyin');
      if (!record) continue;
      if (xhs && record.type === 'video' || dy && !record.images?.length && !record.image_post_info?.images?.length) return { kind: 'video', url, title: record.title || record.desc?.split('\n')[0] || '', author: record.user?.nickname || record.author?.nickname || '' };
      const images = xhs ? (record.imageList || []).map(i => i.infoList?.find(v => v.imageScene === 'WB_DFT')?.url || i.urlDefault || i.url) : (record.images || record.image_post_info?.images || []).map(i => i.url_list?.[0] || i.display_image?.url_list?.[0]);
      if (!images.length || images.length > 100) throw fail('未取得完整图集或图集超过 100 张');
      const urls = images.map(v => v && absolute(v, url));
      if (urls.some(v => !v)) throw fail('图集中有无法解析的图片地址');
      return { kind: 'note', url, title: record.title || record.desc?.split('\n')[0] || '手机采集', content: record.desc || '', images: urls, author: record.user?.nickname || record.author?.nickname || '' };
    }
    // Do not archive login screens or unrelated recommendation thumbnails.
    if (dy || /video/i.test(meta('og:type'))) return { kind: 'video', url };
    throw fail('平台未提供这篇作品的完整数据，可能需要登录或验证；可从原 App 直接分享图片，或用浏览器扩展采集');
  }
  if (/(^|\.)(bilibili\.com|b23\.tv|x\.com|twitter\.com)$/.test(host)) return { kind: 'video', url };
  const title = meta('og:title') || document.title || '网页采集', author = meta('author');
  for (const node of document.querySelectorAll('script,style,noscript,iframe,form,nav,footer,header,svg')) node.remove();
  for (const image of document.querySelectorAll('img')) {
    const src = absolute(image.getAttribute('data-src') || image.getAttribute('data-original') || image.getAttribute('src') || '', url);
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
