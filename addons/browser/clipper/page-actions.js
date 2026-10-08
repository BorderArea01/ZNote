import { collectGallery, collectVideo, record, capturePage, startCaptureRegion, finishCaptureRegion } from './actions.js';
import { api, settings, serverUrl } from './client.js';

// Content scripts act only on their own top frame. Never trust a page tabId,
// server URL or arbitrary API path supplied in a message.
export async function pageAction(message, sender) {
  const tab = await chrome.tabs.get(sender.tab.id);
  const page = new URL(sender.url);
  if (!/^https?:$/.test(page.protocol) || page.origin !== new URL(tab.url).origin) throw Error('当前页面已切换，请重试');
  if (message.type === 'page-tools-position') {
    if (message.position !== undefined) {
      const p=message.position;
      if(!p || ![p.x,p.y].every(n=>Number.isFinite(n)&&n>=0&&n<=100000))throw Error('工具栏位置无效');
      await chrome.storage.local.set({pageToolsPosition:{x:p.x,y:p.y}});
    }
    return {position:(await chrome.storage.local.get('pageToolsPosition')).pageToolsPosition};
  }
  if (message.type === 'page-tools-status') {
    if(!['captures','imports'].includes(message.kind)||!/^[a-f\d-]{36}$/i.test(message.id||''))throw Error('采集任务无效');
    return {job:await api(`/api/${message.kind}/${message.id}`)};
  }
  if (message.type === 'region-capture-selection') return {item:await finishCaptureRegion(tab,message.selection)};
  switch (message.action) {
    case 'work': return {job:await collectGallery(tab,tab.url,{dedupe:true})};
    case 'link':
      if(typeof message.text!=='string'||message.text.length>10000)throw Error('作品链接或分享文字过长');
      return {job:await collectGallery(tab,message.text,{dedupe:true})};
    case 'video': return {job:await collectVideo(tab)};
    case 'region': return await startCaptureRegion(tab);
    case 'screenshot': return {item:await record(()=>capturePage(tab))};
    case 'article': await chrome.tabs.create({url:chrome.runtime.getURL('article.html')+'?tab='+tab.id});return {};
    case 'settings': await chrome.runtime.openOptionsPage();return {};
    case 'library': await chrome.tabs.create({url:serverUrl((await settings()).server)});return {};
    default: throw Error('未知采集操作');
  }
}
