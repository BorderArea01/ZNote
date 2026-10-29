import {videoDetails} from './video-details.js';
import { blockedSite } from './site-policy.js';
import {readPlayableVideo} from './video-fetch.js';
import {normalizeServer,requestAt,routeConnection,remotePathAllowed,remoteCapture} from './connection-routes.js';
export const defaults = { server: 'http://localhost:3741', token: '', remoteServer:'', remoteToken:'', collection_id: '', tags: '', hover: true, dock: true, saveAction: 'save', downloadKey: 's', saveKey: 'z', previewWidth: 720, blockedSites: [], largeImageDefault: 'inherit' };
export async function settings() {
  const stored = await chrome.storage.local.get([...Object.keys(defaults), 'shortcutVersion']);
  const config = { ...defaults, ...stored };
  config.saveAction = stored.saveAction === 'download' ? 'download' : 'save';
  // The original S/K pair was also persisted when changing preview size or visibility.
  // Interpret that legacy default as S/Z; explicit choices saved by this version stay intact.
  if (!stored.shortcutVersion && config.downloadKey === 's' && config.saveKey === 'k') config.saveKey = 'z';
  return config;
}
export const serverUrl=normalizeServer;
export const connection=async(config=null,options={})=>routeConnection(config||await settings(),options);
export async function jobConnection(kind,id,config=null){
  config ||= await settings();
  const key='captureRoute:'+kind+':'+id,stored=await chrome.storage.local.get([key,'lastCapture','lastImport']);
  let ref=stored[key];
  if(!ref){const legacy=stored[kind==='imports'?'lastImport':'lastCapture'];if(legacy?.id===id)ref=legacy;}
  if(!ref?.server)return {server:config.server,token:config.token,remote:false,kind};
  const server=serverUrl(ref.server),remote=!!config.remoteServer&&server===serverUrl(config.remoteServer);
  if(!remote&&server!==serverUrl(config.server))throw Error('任务属于另一个知识库地址，请恢复原连接后查询');
  const token=remote?config.remoteToken:config.token;if(!token)throw Error('原任务入口尚未授权，请重新连接后查询');
  return {...config,server,token,remote,kind:ref.kind||kind};
}
export async function api(path, options = {}, config = null) {
  config ||= await settings();
  const task=path.match(/^\/api\/(captures|imports)\/([a-f\d-]{36})(\/retry)?$/),create=options.method==='POST'&&['/api/captures','/api/imports'].includes(path);
  const route=task?await jobConnection(task[1],decodeURIComponent(task[2]),config):await connection(config,{localOnly:!remotePathAllowed(path)&&path!=='/api/imports',signal:options.signal});
  const originalKind=path==='/api/imports'?'imports':'captures';let kind=task?route.kind:originalKind;
  if(route.remote){
    if(task){kind=route.kind==='imports'?'captures':route.kind;path=`/api/${kind}/${task[2]}${task[3]||''}`;}
    if(create){const input=JSON.parse(options.body||'{}');if(path==='/api/imports')input.text=input.url;path='/api/captures';kind='captures';options={...options,body:JSON.stringify(remoteCapture(input))};}
    if(!remotePathAllowed(path))throw Error('Cloudflare 备用只支持链接采集，此操作需要直连知识库');
  }
  const data=await requestAt(route,path,options);
  if(create&&data.id){
    const ref={server:serverUrl(route.server),kind,time:Date.now()};
    await chrome.storage.local.set({['captureRoute:'+originalKind+':'+data.id]:ref,['captureRoute:'+kind+':'+data.id]:ref});
  }
  if(data&&typeof data==='object'&&!Array.isArray(data))data.connection={server:serverUrl(route.server),remote:route.remote,kind};
  return data;
}
export async function saveImage(blob, details, signal, config = null) {
  if (blob.size > 100 * 1024 * 1024) throw new Error('图片超过 100 MB');
  config ||= await settings();
  const data = new FormData();
  data.set('file', blob, details.filename || '网页图片.png');
  if (['original', 'compress'].includes(config.largeImageDefault)) data.set('image_size_mode', config.largeImageDefault);
  data.set('title', (details.title || details.filename || '网页图片').slice(0, 200));
  data.set('content', [details.capture_note || (details.image_url ? '' : '当前页面可见区域截图'), /^https?:\/\//i.test(details.source_url || '') ? `来源链接：${details.source_url}` : ''].filter(Boolean).join('\n\n'));
  data.set('tags', JSON.stringify(config.tags.split(/[,，]/).map(t => t.trim()).filter(Boolean)));
  if (config.collection_id) data.set('collection_id', config.collection_id);
  if (/^https?:\/\//i.test(details.source_url || '')) data.set('source_url', details.source_url);
  for(const field of ['group_key','group_index','group_title'])if(details[field]!==undefined)data.set(field,details[field]);
  data.set('captured_at', new Date().toISOString());
  return api('/api/assets', { method: 'POST', body: data, signal }, config);
}
export async function prepareImageRequests() {
  await chrome.declarativeNetRequest.updateSessionRules({removeRuleIds:[8301],addRules:[{
    id:8301,priority:1,action:{type:'modifyHeaders',requestHeaders:[{header:'Referer',operation:'set',value:'https://www.pixiv.net/'}]},
    condition:{requestDomains:['pximg.net'],initiatorDomains:[chrome.runtime.id],resourceTypes:['xmlhttprequest']}
  }]});
}
export async function limitedImage(url, signal) {
  if (!/^(https?:|data:image\/)/i.test(url)) throw new Error('此图片地址无法直接获取，可使用页面截图');
  // Offscreen documents expose only runtime; their background task installs
  // this fixed, extension-only rule before handing them any image downloads.
  if(/^https:\/\/[^/]*\.pximg\.net\//i.test(url) && chrome.declarativeNetRequest)await prepareImageRequests();
  const response = await fetch(url, { credentials: 'include', signal: signal || AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`读取图片失败 ${response.status}，可改用页面截图`);
  const mime = response.headers.get('content-type') || '';
  if (mime && !/^(image\/|application\/octet-stream)/i.test(mime)) { await response.body?.cancel(); throw new Error('候选地址没有返回图片'); }
  if (Number(response.headers.get('content-length') || 0) > 100 * 1024 * 1024) { await response.body?.cancel(); throw new Error('图片超过 100 MB'); }
  const reader = response.body.getReader(), chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length;
      if (size > 100 * 1024 * 1024) throw new Error('图片超过 100 MB');
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  return new Blob(chunks, { type: response.headers.get('content-type') || 'application/octet-stream' });
}
export async function saveDirectVideo(url, sourceUrl, title, signal, metadata = {}, providedConfig = null) {
  const config = providedConfig || await settings();
  if (blockedSite(sourceUrl, config)) throw new Error('此网站已停用 ZNote 媒体采集，可在扩展弹窗或设置中恢复');
  if (!/^https?:\/\//i.test(url || '')) throw new Error('播放器使用分段或 blob 地址，请改用“采集此页面的视频”');
  const videoSignal = signal || AbortSignal.timeout(300000);
  const blob = await readPlayableVideo(url, { signal: videoSignal, expectedTotal: Number(metadata.total_bytes) || 0 });
  const form = new FormData();
  form.set('file', blob, '网页视频.mp4');
  const details=videoDetails({...metadata,title:title||metadata.title},config.tags.split(/[,，]/).map(t=>t.trim()).filter(Boolean));
  form.set('title',details.title);
  form.set('content',details.content);
  if (/^https?:\/\//i.test(sourceUrl || '')) form.set('source_url', sourceUrl);
  form.set('tags',JSON.stringify(details.tags));
  if (config.collection_id) form.set('collection_id', config.collection_id);
  return api('/api/videos', { method: 'POST', body: form, signal: videoSignal }, config);
}
