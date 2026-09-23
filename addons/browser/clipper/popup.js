import { settings, serverUrl, api } from './client.js';
import { siteControlState, toggleSiteBlock } from './site-policy.js';
const status = document.getElementById('status'), capture = document.getElementById('capture');
const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
document.getElementById('article').addEventListener('click',async()=>{await chrome.tabs.create({url:chrome.runtime.getURL('article.html')+'?tab='+tab.id});window.close();});
let behavior = await settings();
document.getElementById('shortcut-help').textContent = `悬停大图 · ${behavior.downloadKey.toUpperCase()} 下载 · ${behavior.saveKey.toUpperCase()} 入库`;
const siteName = document.getElementById('site-name'), siteStatus = document.getElementById('site-status'), siteToggle = document.getElementById('site-toggle');
const discoverButton = document.getElementById('discover'), platformVideoButton = document.getElementById('video');
const galleryInput = document.getElementById('gallery-link'), galleryButton = document.getElementById('gallery-capture'), galleryStatus = document.getElementById('gallery-status'), galleryOpen = document.getElementById('gallery-open');
if (tab?.url && /^https?:/i.test(tab.url)) galleryInput.value = tab.url;
let siteState;
function renderSiteState(message = '') {
  siteState = siteControlState(tab?.url, behavior);
  siteName.textContent = (() => { try { return new URL(tab?.url).host; } catch { return '当前页面不支持'; } })();
  discoverButton.disabled = !siteState.supported || siteState.blocked;
  platformVideoButton.disabled = !siteState.supported || siteState.blocked;
  // Link capture is intentionally available even on pages without media
  // injection (for example a blank tab): the pasted URL is the source page.
  galleryButton.disabled = galleryButton.dataset.busy === 'true' || (siteState.supported && siteState.blocked && !siteState.automatic);
  siteToggle.disabled = !siteState.supported || siteState.automatic;
  siteToggle.setAttribute('aria-pressed', String(siteState.blocked));
  if (!siteState.supported) {
    siteToggle.textContent = '不适用于此页面';
    siteStatus.textContent = '仅支持普通 HTTP(S) 网站';
  } else if (siteState.automatic) {
    siteToggle.textContent = '自动停用';
    siteStatus.textContent = 'ZNote 页面不会显示图片预览或视频嗅探';
  } else if (siteState.blocked && siteState.direct.length) {
    siteToggle.textContent = '恢复此网址';
    siteStatus.textContent = siteState.other.length
      ? `本站规则已启用；移除后仍会匹配：${siteState.other.join(', ')}`
      : '图片预览、视频浮窗和资源嗅探已关闭';
  } else if (siteState.blocked) {
    siteToggle.textContent = '管理黑名单';
    siteStatus.textContent = `此网址已被规则覆盖：${siteState.matching.join(', ')}`;
  } else {
    siteToggle.textContent = '禁用此网址';
    siteStatus.textContent = message || '关闭此网站的悬停预览、视频浮窗和资源嗅探';
  }
}
renderSiteState();
siteToggle.addEventListener('click', async () => {
  if (!siteState?.supported || siteState.automatic) return;
  if (siteState.blocked && !siteState.direct.length) { await chrome.runtime.openOptionsPage(); return; }
  siteToggle.disabled = true;
  try {
    const next = toggleSiteBlock(tab.url, behavior);
    if (!next.changed) throw new Error('请在连接设置中调整覆盖此网址的黑名单规则');
    await chrome.storage.local.set({ blockedSites: next.blockedSites });
    behavior = await settings();
    renderSiteState(next.blocked ? '此网址已禁用，当前页面立即生效' : '此网址已恢复');
  } catch (error) {
    siteStatus.textContent = error.message;
  } finally { siteToggle.disabled = false; renderSiteState(siteStatus.textContent); }
});
document.getElementById('discover').addEventListener('click',async()=>{try{const result=await chrome.runtime.sendMessage({type:'open-panel',tabId:tab.id});if(!result?.ok)throw new Error(result?.error||'打开失败');window.close();}catch(e){status.textContent=e.message;}});
async function show() {
  const { lastResult } = await chrome.storage.local.get('lastResult');
  if (!lastResult) return;
  status.textContent = lastResult.message;
  const link = document.getElementById('open'); link.hidden = !lastResult.ok;
  if (lastResult.ok) link.href = serverUrl((await settings()).server) + '/#item/' + lastResult.itemId;
}
show();
async function showGallery() {
  const { lastCapture } = await chrome.storage.local.get('lastCapture');
  if (!lastCapture) return;
  const config = await settings(); if (serverUrl(config.server) !== serverUrl(lastCapture.server)) return;
  try {
    const job = await api('/api/captures/' + lastCapture.id);
    galleryStatus.textContent = job.message;
    galleryButton.dataset.busy = String(['queued', 'running'].includes(job.status));
    galleryButton.textContent = galleryButton.dataset.busy === 'true' ? '图组采集中…' : '获取图组并保存';
    galleryOpen.hidden = job.status !== 'completed';
    if (job.status === 'completed') galleryOpen.href = serverUrl(config.server) + '/#item/' + job.item_id;
    if (['completed','failed'].includes(job.status)) await chrome.action.setBadgeText({ text: job.status === 'completed' ? '✓' : '!' });
  } catch (e) { galleryStatus.textContent = e.message; galleryOpen.hidden = true; }
}
galleryButton.addEventListener('click', async () => {
  galleryButton.dataset.busy = 'true'; galleryButton.disabled = true; galleryStatus.textContent = '正在提交图组采集…'; galleryOpen.hidden = true;
  try {
    const result = await chrome.runtime.sendMessage({ type: 'gallery', tabId: tab.id, text: galleryInput.value.trim() });
    if (!result?.ok) throw new Error(result?.error || '提交失败');
    await showGallery();
  } catch (e) { galleryStatus.textContent = e.message; }
  finally { galleryButton.dataset.busy = 'false'; await showGallery(); renderSiteState(); }
});
showGallery(); setInterval(showGallery, 2000);
const video = document.getElementById('video'), videoStatus = document.getElementById('video-status'), cancel = document.getElementById('cancel-video'), videoLink = document.getElementById('video-open');
async function showVideo() {
  const { lastImport } = await chrome.storage.local.get('lastImport');
  if (!lastImport) return;
  const config = await settings(); if (serverUrl(config.server) !== serverUrl(lastImport.server)) return;
  try {
    const job = await api('/api/imports/' + lastImport.id);
    videoStatus.textContent = job.message; cancel.hidden = !['queued','running'].includes(job.status);
    videoLink.hidden = job.status !== 'completed';
    if (job.status === 'completed') videoLink.href = serverUrl(config.server) + '/#item/' + job.item_id;
    if (['completed','failed','cancelled'].includes(job.status)) await chrome.action.setBadgeText({ text: job.status === 'completed' ? '✓' : '!' });
  } catch (e) { videoStatus.textContent = e.message; cancel.hidden = true; }
}
video.addEventListener('click', async () => {
  video.disabled = true; videoStatus.textContent = '正在提交采集…';
  try { const result = await chrome.runtime.sendMessage({ type: 'video', tabId: tab.id }); if (!result?.ok) throw new Error(result?.error || '提交失败'); await showVideo(); }
  catch (e) { videoStatus.textContent = e.message; } finally { video.disabled = false; }
});
cancel.addEventListener('click', async () => {
  try { const { lastImport } = await chrome.storage.local.get('lastImport'); await api('/api/imports/' + lastImport.id, { method: 'DELETE' }); await showVideo(); }
  catch (e) { videoStatus.textContent = e.message; }
});
showVideo(); setInterval(showVideo, 2000);
document.getElementById('settings').addEventListener('click', () => chrome.runtime.openOptionsPage());
capture.addEventListener('click', async () => {
  capture.disabled = true; status.textContent = '正在截图并上传…';
  try { const result = await chrome.runtime.sendMessage({ type: 'capture', tabId: tab.id }); if (!result?.ok) throw new Error(result?.error || '截图失败'); await show(); }
  catch (e) { status.textContent = e.message; }
  finally { capture.disabled = false; }
});
