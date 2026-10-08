import { record, collectImage, capturePage, captureRegion, startCaptureRegion, collectVideo, collectGallery, captureJob } from './actions.js';
import { pageAction } from './page-actions.js';
import { saveDirectVideo, settings, api } from './client.js';
import { discover } from './discovery.js';
import {inlineGalleryTicket} from './gallery-ticket.js';
import {updateMediaTask,downloadMediaBlob,startMediaTask} from './media-tasks.js';
import {contextMenuEntries} from './entry-menu.js';
let directVideoBusy = false;
async function setupContextMenus() {
  const config=await settings();
  chrome.contextMenus.removeAll(() => {
    for(const entry of contextMenuEntries(config.saveAction))chrome.contextMenus.create(entry);
  });
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !['hover', 'dock', 'saveAction', 'downloadKey', 'saveKey', 'shortcutVersion', 'previewWidth', 'blockedSites', 'server'].some(key => key in changes)) return;
  if(changes.saveAction)setupContextMenus();
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
  if (info.menuItemId === 'znote-work') collectGallery(tab).catch(() => {});
  if (info.menuItemId === 'znote-image') record(() => collectImage(info, tab)).catch(() => {});
  if (info.menuItemId === 'znote-image-current') record(() => collectImage(info, tab, false)).catch(() => {});
  if (info.menuItemId === 'znote-capture') record(() => capturePage(tab)).catch(() => {});
  if (info.menuItemId === 'znote-capture-region') captureRegion(tab).catch(() => {});
  if (info.menuItemId === 'znote-article') chrome.tabs.create({url:chrome.runtime.getURL('article.html')+'?tab='+tab.id});
  if (info.menuItemId === 'znote-video') collectVideo(tab, info.pageUrl || tab.url).catch(() => {});
  if (info.menuItemId === 'znote-video-link') collectVideo(tab, info.linkUrl).catch(() => {});
  if (info.menuItemId === 'znote-gallery-link') collectGallery(tab, info.linkUrl).catch(() => {});
  if (info.menuItemId === 'znote-video-file') record(async () => {
    if (directVideoBusy) throw new Error('已有一个视频文件正在上传，请等待完成');
    directVideoBusy = true;
    try { const config=await settings(),metadata=await chrome.tabs.sendMessage(tab.id,{type:'video-metadata',url:info.srcUrl},{frameId:info.frameId||0}).catch(()=>({}));if(config.saveAction==='download')return {...await startMediaTask({id:info.srcUrl,url:info.srcUrl,kind:'video',source_url:metadata.source_url||info.pageUrl||tab.url,title:metadata.title||tab.title},'download',tab.id,config),kind:'download'};return await saveDirectVideo(info.srcUrl,metadata.source_url||info.pageUrl||tab.url,metadata.title||tab.title,undefined,metadata,config); } finally { directVideoBusy = false; }
  }).catch(() => {});
});
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if(sender.id===chrome.runtime.id&&sender.tab&&sender.frameId===0&&['page-tools-action','page-tools-status','page-tools-position','region-capture-selection'].includes(message.type)){
    pageAction(message,sender).then(value=>reply({ok:true,...value}),error=>reply({ok:false,error:error.message}));return true;
  }
  if(message.type==='znote-post-ready'&&sender.id===chrome.runtime.id&&sender.tab&&sender.frameId===0){reply({ok:true,protocol:1,version:chrome.runtime.getManifest().version});return;}
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
  if (sender.id === chrome.runtime.id && sender.tab && sender.frameId === 0 &&
      ['xhs-post-capture', 'xhs-post-status', 'x-post-capture', 'x-post-status'].includes(message.type)) {
    const page = (() => { try { return new URL(sender.url); } catch { return null; } })();
    const source = (() => { try { return new URL(message.url); } catch { return null; } })();
    const workPath = /^\/(?:explore|discovery\/item)\/[a-f\d]+\/?$/i;
    const isX = message.type.startsWith('x-post-');
    const xHost = host => /^(?:www\.|mobile\.)?(?:x|twitter)\.com$/.test(host || '');
    if (isX ? page?.protocol !== 'https:' || !xHost(page.hostname) || (message.type === 'x-post-capture' && (source?.protocol !== 'https:' || !xHost(source.hostname) || !/^\/[\w]+\/status\/\d+\/?$/.test(source.pathname))) : page?.protocol !== 'https:' || page.hostname !== 'www.xiaohongshu.com' ||
        (message.type === 'xhs-post-capture' && (source?.protocol !== 'https:' || source.hostname !== page.hostname || !workPath.test(source.pathname)))) {
      reply({ ok: false, error: '只可采集当前平台的单条作品链接' }); return;
    }
    if (message.type === 'xhs-post-capture' && message.pageHtml && (typeof message.pageHtml !== 'string' || new TextEncoder().encode(message.pageHtml).length > 1500000)) {
      reply({ ok: false, error: '浏览器作品数据过大' }); return;
    }
    const operation = message.type.endsWith('-capture')
      ? collectGallery(sender.tab, source.href, { dedupe: true, browserHtml: message.pageHtml, browserPost: isX ? message.browserPost : null })
      : captureJob(String(message.id||''),sender.tab.id);
    operation.then(job => reply({ ok: true, job }), error => reply({ ok: false, error: error.message })); return true;
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
  if (message.type === 'capture-region') {
    chrome.tabs.get(message.tabId).then(captureRegion).then(item => reply({ok:true,item}),e=>reply({ok:false,error:e.message})); return true;
  }
  if (message.type === 'capture-region-start') {
    chrome.tabs.get(message.tabId).then(startCaptureRegion).then(value=>reply({ok:true,...value}),e=>reply({ok:false,error:e.message}));return true;
  }
  if (message.type !== 'capture') return;
  record(async () => {
    const tab = await chrome.tabs.get(message.tabId);
    return capturePage(tab);
  }).then(item => reply({ ok: true, item }), error => reply({ ok: false, error: error.message }));
  return true;
});
