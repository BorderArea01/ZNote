import { settings, serverUrl, api } from './client.js';
const status = document.getElementById('status'), capture = document.getElementById('capture');
const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
document.getElementById('article').addEventListener('click',async()=>{await chrome.tabs.create({url:chrome.runtime.getURL('article.html')+'?tab='+tab.id});window.close();});
const behavior = await settings();
document.getElementById('shortcut-help').textContent = `悬停大图 · ${behavior.downloadKey.toUpperCase()} 下载 · ${behavior.saveKey.toUpperCase()} 入库`;
document.getElementById('discover').addEventListener('click',async()=>{try{const result=await chrome.runtime.sendMessage({type:'open-panel',tabId:tab.id});if(!result?.ok)throw new Error(result?.error||'打开失败');window.close();}catch(e){status.textContent=e.message;}});
async function show() {
  const { lastResult } = await chrome.storage.local.get('lastResult');
  if (!lastResult) return;
  status.textContent = lastResult.message;
  const link = document.getElementById('open'); link.hidden = !lastResult.ok;
  if (lastResult.ok) link.href = serverUrl((await settings()).server) + '/#item/' + lastResult.itemId;
}
show();
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
