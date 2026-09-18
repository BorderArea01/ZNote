import { saveImage, limitedImage, api, settings } from './client.js';
import { blockedSite } from './site-policy.js';
const assertSiteAllowed = (url, config) => {
  if (blockedSite(url, config)) throw new Error('此网站已停用 ZNote 媒体采集，可在扩展弹窗或设置中恢复');
};
export async function record(operation) {
  await chrome.action.setBadgeText({ text: '…' });
  try {
    const item = await operation();
    await chrome.storage.local.set({ lastResult: { ok: true, message: item.duplicate ? '此知识库已收录，已补充来源' : '已保存到知识库', itemId: item.id, time: Date.now() } });
    await chrome.action.setBadgeBackgroundColor({ color: '#5865ce' }); await chrome.action.setBadgeText({ text: '✓' });
    return item;
  } catch (error) {
    await chrome.storage.local.set({ lastResult: { ok: false, message: error.message, time: Date.now() } });
    await chrome.action.setBadgeBackgroundColor({ color: '#af453e' }); await chrome.action.setBadgeText({ text: '!' });
    throw error;
  }
}
export async function collectImage(info, tab, preferOriginal = true) {
  const config = await settings();
  assertSiteAllowed(info.pageUrl || tab?.url, config);
  let candidates = [];
  if (preferOriginal) {
    try { candidates = await chrome.tabs.sendMessage(tab.id, { type: 'image-candidates', srcUrl: info.srcUrl }, { frameId: info.frameId || 0 }); } catch {}
  }
  const urls = [...new Set([...(Array.isArray(candidates) ? candidates.map(c => c.url) : []), info.srcUrl])];
  let lastError;
  for (const url of urls) {
    let image;
    try { image = await limitedImage(url); } catch (e) { lastError = e; continue; }
    let filename; try { if (/^https?:/i.test(url)) filename = decodeURIComponent(new URL(url).pathname.split('/').pop()); } catch {}
    try {
      return await saveImage(image, { filename: filename || '网页图片.png', title: info.selectionText || filename || tab?.title || '网页图片', image_url: /^https?:/i.test(url) ? url : undefined, source_url: info.pageUrl || tab?.url,
        capture_note: preferOriginal ? (url !== info.srcUrl ? '已从网页提供的高清候选地址采集，未放大或重新编码。' : '未获得可用的更高清版本，已保存当前图片。') : '已保存当前图片。' }, undefined, config);
    } catch (e) { if (e.status !== 415) throw e; lastError = e; }
  }
  throw lastError || new Error('无法读取图片，可改用页面截图');
}
export async function capturePage(tab) {
  const [active] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
  if (active?.id !== tab.id) throw new Error('当前标签页已经改变，请重新点击截图');
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  const blob = await (await fetch(dataUrl)).blob();
  return saveImage(blob, { title: `${tab.title || '网页'} · 截图`, filename: '页面截图.png', source_url: tab.url });
}
export async function collectVideo(tab, url = tab.url) {
  const config = await settings();
  assertSiteAllowed(tab?.url, config);
  try {
    const job = await api('/api/imports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, collection_id: config.collection_id || null, tags: config.tags.split(/[,，]/).map(t => t.trim()).filter(Boolean) }) });
    // The server owns long downloads; closing the popup or suspending the worker is safe.
    await chrome.storage.local.set({ lastImport: { id: job.id, server: serverUrlForJob(config.server) } });
    await chrome.action.setBadgeText({ text: '…' });
    return job;
  } catch (e) {
    await chrome.storage.local.set({ lastResult: { ok: false, message: e.message, time: Date.now() } });
    await chrome.action.setBadgeText({ text: '!' }); throw e;
  }
}
const serverUrlForJob = value => value.replace(/\/$/, '');
