import {videoDetails} from './video-details.js';
export const defaults = { server: 'http://localhost:3741', token: '', collection_id: '', tags: '', hover: true, dock: true, downloadKey: 's', saveKey: 'z', previewWidth: 720, blockedSites: [] };
export async function settings() {
  const stored = await chrome.storage.local.get([...Object.keys(defaults), 'shortcutVersion']);
  const config = { ...defaults, ...stored };
  // The original S/K pair was also persisted when changing preview size or visibility.
  // Interpret that legacy default as S/Z; explicit choices saved by this version stay intact.
  if (!stored.shortcutVersion && config.downloadKey === 's' && config.saveKey === 'k') config.saveKey = 'z';
  return config;
}
export function serverUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('请输入 HTTP(S) 服务器地址');
  return url.href.replace(/\/$/, '');
}
export async function api(path, options = {}, config = null) {
  config ||= await settings();
  if (!config.token) throw new Error('请先打开连接设置，填写 ZNote 写入令牌');
  const response = await fetch(serverUrl(config.server) + path, { ...options, credentials: 'omit', redirect: 'error', headers: { ...options.headers, Authorization: 'Bearer ' + config.token }, signal: options.signal || AbortSignal.timeout(30000) });
  let data; try { data = await response.json(); } catch { throw new Error('服务器未返回有效响应，请检查地址'); }
  if (!response.ok) throw Object.assign(new Error(data.error || `请求失败 ${response.status}`), { status: response.status });
  return data;
}
export async function saveImage(blob, details, signal, config = null) {
  if (blob.size > 25 * 1024 * 1024) throw new Error('图片超过 25 MB');
  config ||= await settings();
  const data = new FormData();
  data.set('file', blob, details.filename || '网页图片.png');
  data.set('title', (details.title || details.filename || '网页图片').slice(0, 200));
  data.set('content', [details.image_url ? details.capture_note || '' : '当前页面可见区域截图', /^https?:\/\//i.test(details.source_url || '') ? `来源链接：${details.source_url}` : ''].filter(Boolean).join('\n\n'));
  data.set('tags', JSON.stringify(config.tags.split(/[,，]/).map(t => t.trim()).filter(Boolean)));
  if (config.collection_id) data.set('collection_id', config.collection_id);
  if (/^https?:\/\//i.test(details.source_url || '')) data.set('source_url', details.source_url);
  data.set('captured_at', new Date().toISOString());
  return api('/api/assets', { method: 'POST', body: data, signal }, config);
}
export async function limitedImage(url, signal) {
  if (!/^(https?:|data:image\/)/i.test(url)) throw new Error('此图片地址无法直接获取，可使用页面截图');
  if(/^https:\/\/[^/]*\.pximg\.net\//i.test(url)) {
    await chrome.declarativeNetRequest.updateSessionRules({removeRuleIds:[8301],addRules:[{
      id:8301,priority:1,action:{type:'modifyHeaders',requestHeaders:[{header:'Referer',operation:'set',value:'https://www.pixiv.net/'}]},
      condition:{requestDomains:['pximg.net'],initiatorDomains:[chrome.runtime.id],resourceTypes:['xmlhttprequest']}
    }]});
  }
  const response = await fetch(url, { credentials: 'include', signal: signal || AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`读取图片失败 ${response.status}，可改用页面截图`);
  const mime = response.headers.get('content-type') || '';
  if (mime && !/^(image\/|application\/octet-stream)/i.test(mime)) { await response.body?.cancel(); throw new Error('候选地址没有返回图片'); }
  if (Number(response.headers.get('content-length') || 0) > 25 * 1024 * 1024) throw new Error('图片超过 25 MB');
  const reader = response.body.getReader(), chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length;
      if (size > 25 * 1024 * 1024) throw new Error('图片超过 25 MB');
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  return new Blob(chunks, { type: response.headers.get('content-type') || 'application/octet-stream' });
}
export async function saveDirectVideo(url, sourceUrl, title, signal, metadata = {}) {
  if (!/^https?:\/\//i.test(url || '')) throw new Error('播放器使用分段或 blob 地址，请改用“采集此页面的视频”');
  const response = await fetch(url, { credentials: 'include', signal: signal || AbortSignal.timeout(300000) });
  if (!response.ok) throw new Error('视频文件访问失败，可改用页面视频采集或下载后上传');
  const max = 500 * 1024 * 1024;
  if (Number(response.headers.get('content-length')) > max) { await response.body?.cancel(); throw new Error('视频超过 500 MB'); }
  const mime = response.headers.get('content-type') || '';
  if (mime && !/^(video\/|application\/octet-stream)/i.test(mime)) { await response.body?.cancel(); throw new Error('此地址不是直接视频文件，请使用页面视频采集'); }
  const reader = response.body.getReader(), chunks = []; let size = 0;
  try { while (true) { const {done,value} = await reader.read(); if (done) break; size += value.length; if (size > max) throw new Error('视频超过 500 MB'); chunks.push(value); } } finally { await reader.cancel(); }
  const config = await settings(), form = new FormData();
  form.set('file', new Blob(chunks, { type: mime || 'video/mp4' }), '网页视频.mp4');
  const details=videoDetails({...metadata,title:title||metadata.title},config.tags.split(/[,，]/).map(t=>t.trim()).filter(Boolean));
  form.set('title',details.title);
  form.set('content',details.content);
  if (/^https?:\/\//i.test(sourceUrl || '')) form.set('source_url', sourceUrl);
  form.set('tags',JSON.stringify(details.tags));
  if (config.collection_id) form.set('collection_id', config.collection_id);
  return api('/api/videos', { method: 'POST', body: form, signal: signal || AbortSignal.timeout(300000) });
}
