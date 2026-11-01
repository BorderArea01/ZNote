import {blockedSite} from './site-policy.js';
import {settings} from './client.js';
const prefix='inlinePreview:';
export async function createInlinePreview(resource,tabId) {
  if(!['video','hls'].includes(resource.kind))throw Error('此资源不能试播');
  const tab=await chrome.tabs.get(tabId),all=await chrome.storage.session.get(null);
  const old=Object.entries(all).filter(([key])=>key.startsWith(prefix)).sort((a,b)=>b[1].created-a[1].created);
  await chrome.storage.session.remove(old.filter(([,value],index)=>value.tabId===tabId||index>=12||Date.now()-value.created>600000).map(([key])=>key));
  const id=crypto.randomUUID();
  await chrome.storage.session.set({[prefix+id]:{tabId,page:tab.url,created:Date.now(),resource:{kind:resource.kind,url:resource.url,title:resource.title,source_url:resource.source_url,bytes:Number(resource.total_bytes||resource.bytes)||0,playlist_text:resource.playlist_text}}});
  return {preview_url:chrome.runtime.getURL('inline-preview.html')+'?id='+id,preview_id:id,message:'已在浮窗内打开试播'};
}
export async function inlinePreviewMessage(message,sender) {
  const id=String(message.id||'');if(!/^[a-f\d-]{36}$/i.test(id))throw Error('预览记录无效');
  const value=(await chrome.storage.session.get(prefix+id))[prefix+id];
  if(!value||sender.tab?.id!==value.tabId||Date.now()-value.created>600000)throw Error('预览已过期，请重新点击预览');
  if(message.type==='inline-preview-release'){
    if(sender.frameId!==0)throw Error('只能关闭当前页面预览');
    await chrome.storage.session.remove(prefix+id);return {};
  }
  if(sender.url?.split('?')[0]!==chrome.runtime.getURL('inline-preview.html'))throw Error('预览来源无效');
  const tab=await chrome.tabs.get(value.tabId);
  if(tab.url!==value.page||blockedSite(tab.url,await settings()))throw Error('原页面已切换或已停用采集');
  return {resource:value.resource,parent_origin:new URL(value.page).origin};
}
