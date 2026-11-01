import {youtubeVideoId} from './youtube-url.js';
import {youtubeMediaUrl} from './youtube-formats.js';
const KEY='youtubePlaybackRequests';let pending=Promise.resolve();
export function observeYoutubePlayback(details){
  const url=youtubeMediaUrl(details.url);
  if(details.method!=='POST'||details.tabId<0||!url?.searchParams.has('sabr')||!/^https:\/\/(?:www|m|music)\.youtube\.com$/.test(details.initiator||''))return;
  const parts=details.requestBody?.raw||[],size=parts.reduce((n,p)=>n+(p.bytes?.byteLength||0),0);
  if(!size||size>128*1024||parts.some(p=>!p.bytes))return;
  const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(new Uint8Array(part.bytes),offset);offset+=part.bytes.byteLength;}
  const body=btoa(Array.from(bytes,b=>String.fromCharCode(b)).join(''));
  pending=pending.catch(()=>{}).then(async()=>{
    const tab=await chrome.tabs.get(details.tabId).catch(()=>null);if(!youtubeVideoId(tab?.url))return;
    const old=(await chrome.storage.session.get(KEY))[KEY]||{},now=Date.now();
    old[details.tabId]={url:url.href,body,source:tab.url,created:now};
    const entries=Object.entries(old).filter(([,v])=>now-v.created<180000).sort((a,b)=>b[1].created-a[1].created).slice(0,4);
    await chrome.storage.session.set({[KEY]:Object.fromEntries(entries)});
  });return pending;
}
export async function youtubePlaybackRequest(tabId,source){
  await pending.catch(()=>{});const value=(await chrome.storage.session.get(KEY))[KEY]?.[tabId];
  return value&&value.source===source&&Date.now()-value.created<180000?{url:value.url,body:value.body}:null;
}
export function forgetYoutubePlayback(tabId){
  pending=pending.catch(()=>{}).then(async()=>{const values=(await chrome.storage.session.get(KEY))[KEY]||{};if(values[tabId]){delete values[tabId];await chrome.storage.session.set({[KEY]:values});}});return pending;
}
