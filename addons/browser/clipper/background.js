import { record, collectImage, capturePage, collectVideo, collectGallery } from './actions.js';
import { saveDirectVideo, settings, api } from './client.js';
import { discover } from './discovery.js';
import {inlineGalleryTicket} from './gallery-ticket.js';
import {updateMediaTask,downloadMediaBlob} from './media-tasks.js';
let directVideoBusy = false;
function setupContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'znote-image', title: '优先保存高清原图到 ZNote', contexts: ['image'] });
    chrome.contextMenus.create({ id: 'znote-image-current', title: '保存当前图片到 ZNote', contexts: ['image'] });
    chrome.contextMenus.create({ id: 'znote-capture', title: '截图当前页面到 ZNote', contexts: ['page'] });
    chrome.contextMenus.create({ id: 'znote-article', title: '保存页面正文为图文笔记', contexts: ['page'] });
    chrome.contextMenus.create({ id: 'znote-video', title: '采集此页面的视频到 ZNote', contexts: ['page', 'video'] });
    chrome.contextMenus.create({ id: 'znote-video-link', title: '采集此链接的视频到 ZNote', contexts: ['link'] });
    chrome.contextMenus.create({ id: 'znote-gallery-link', title: '按链接采集图组到 ZNote', contexts: ['link'] });
    chrome.contextMenus.create({ id: 'znote-video-file', title: '保存当前视频文件到 ZNote', contexts: ['video'] });
  });
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !['hover', 'dock', 'downloadKey', 'saveKey', 'shortcutVersion', 'previewWidth', 'blockedSites', 'server'].some(key => key in changes)) return;
  chrome.tabs.query({url: ['http://*/*', 'https://*/*']}).then(tabs => Promise.allSettled(tabs.map(tab => chrome.tabs.sendMessage(tab.id, {type: 'media-settings-changed'})))).catch(() => {});
});
chrome.runtime.onInstalled.addListener(() => {
  setupContextMenus();
  chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
});
chrome.runtime.onStartup.addListener(setupContextMenus);
// Also refresh menus when a developer reloads an unpacked extension. Chrome
// does not consistently emit onInstalled for that workflow.
setupContextMenus();
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'znote-image') record(() => collectImage(info, tab)).catch(() => {});
  if (info.menuItemId === 'znote-image-current') record(() => collectImage(info, tab, false)).catch(() => {});
  if (info.menuItemId === 'znote-capture') record(() => capturePage(tab)).catch(() => {});
  if (info.menuItemId === 'znote-article') chrome.tabs.create({url:chrome.runtime.getURL('article.html')+'?tab='+tab.id});
  if (info.menuItemId === 'znote-video') collectVideo(tab, info.pageUrl || tab.url).catch(() => {});
  if (info.menuItemId === 'znote-video-link') collectVideo(tab, info.linkUrl).catch(() => {});
  if (info.menuItemId === 'znote-gallery-link') collectGallery(tab, info.linkUrl).catch(() => {});
  if (info.menuItemId === 'znote-video-file') record(async () => {
    if (directVideoBusy) throw new Error('已有一个视频文件正在上传，请等待完成');
    directVideoBusy = true;
    try { const metadata=await chrome.tabs.sendMessage(tab.id,{type:'video-metadata',url:info.srcUrl},{frameId:info.frameId||0}).catch(()=>({}));return await saveDirectVideo(info.srcUrl,metadata.source_url||info.pageUrl||tab.url,metadata.title||tab.title,undefined,metadata); } finally { directVideoBusy = false; }
  }).catch(() => {});
});
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if(sender.id===chrome.runtime.id&&message.target==='background'&&message.type==='media-task-update'){
    updateMediaTask(message.task).then(task=>reply({ok:true,task}),error=>reply({ok:false,error:error.message}));return true;
  }
  if(sender.id===chrome.runtime.id&&message.target==='background'&&message.type==='media-task-download'){
    downloadMediaBlob(message).then(value=>reply({ok:true,value}),error=>reply({ok:false,error:error.message}));return true;
  }
  if(message.type==='inline-gallery-load'&&sender.id===chrome.runtime.id){inlineGalleryTicket(sender).then(value=>reply({ok:true,value}),e=>reply({ok:false,error:e.message}));return true;}
  if (message.type === 'znote-connect' && sender.id === chrome.runtime.id && sender.tab && sender.frameId === 0) {
    (async () => {
      const server = new URL(sender.url).origin;
      if (!/^https?:/.test(server)) throw new Error('请在 ZNote 网页中连接');
      const config = await settings();
      if (config.server === server && config.token) {
        try { if ((await api('/api/me')).scope === 'write') return; } catch {}
      }
      const response = await fetch(server + '/api/clipper/redeem', {method:'POST',credentials:'omit',redirect:'error',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:message.code}),signal:AbortSignal.timeout(15000)});
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '连接失败');
      if (!/^zn_[a-f0-9]{64}$/.test(result.token)) throw new Error('服务器返回的令牌无效');
      const preferences = await api('/api/preferences',{}, {server,token:result.token});
      await chrome.storage.local.set({server,token:result.token,collection_id:config.server === server ? config.collection_id : (preferences.default_collection_id === 'unfiled' ? '' : preferences.default_collection_id || '')});
    })().then(()=>reply({ok:true}),e=>reply({ok:false,error:e.message})); return true;
  }
  if (sender.id === chrome.runtime.id && sender.tab && /^(media-|hover-resource)/.test(message.type || '')) {
    discover(message, sender).then(value => reply({ ok: true, value }), error => reply({ ok: false, error: error.message })); return true;
  }
  if (sender.id === chrome.runtime.id && sender.url === chrome.runtime.getURL('popup.html') && message.type === 'open-panel') {
    chrome.tabs.sendMessage(message.tabId, { type: 'open-media-panel' }, { frameId: 0 }).then(result => reply(result || { ok: false, error: '此页面未能打开媒体浮窗' }), () => reply({ ok: false, error: '此页面不允许扩展运行，或需要刷新页面' })); return true;
  }
  if (sender.id !== chrome.runtime.id || !['popup.html', 'options.html'].some(path => sender.url === chrome.runtime.getURL(path))) return;
  if (message.type === 'video') {
    chrome.tabs.get(message.tabId).then(tab => collectVideo(tab)).then(job => reply({ ok: true, job }), error => reply({ ok: false, error: error.message })); return true;
  }
  if (message.type === 'gallery') {
    chrome.tabs.get(message.tabId).then(tab => collectGallery(tab, message.text)).then(job => reply({ ok: true, job }), error => reply({ ok: false, error: error.message })); return true;
  }
  if (message.type !== 'capture') return;
  record(async () => {
    const tab = await chrome.tabs.get(message.tabId);
    return capturePage(tab);
  }).then(item => reply({ ok: true, item }), error => reply({ ok: false, error: error.message }));
  return true;
});
