import { settings, serverUrl, api } from './client.js';
import { siteControlState, toggleSiteBlock } from './site-policy.js';
import { pluginShell } from './ui/panel.js';
const $ = id => document.getElementById(id), selectPanel = pluginShell();
const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
let config = await settings(), siteState, galleryBusy = false, taskLoading = false, refreshQueued = false;
const jobs = new Map(), refs = new Map();
$('page-title').textContent = tab?.title || '当前页面';
function renderMode(){
  const download=config.saveAction==='download';
  $('shortcut-help').textContent=download?`${config.downloadKey.toUpperCase()} 下载`:`${config.saveKey.toUpperCase()} 入库`;
  document.querySelector('.destination-row').hidden=download;$('connection-state').hidden=download;
  $('current-capture').firstElementChild.textContent=download?'下载当前作品':'采集当前作品';
  $('gallery-capture').textContent=download?'获取图组并下载':'获取图组并保存';
  $('article').textContent=download?'下载正文':'保存正文';
}
renderMode();
if (/^https?:/i.test(tab?.url || '')) $('gallery-link').value = tab.url;
function renderSite() {
  siteState = siteControlState(tab?.url, config);
  $('site-name').textContent = (() => { try { return new URL(tab.url).host; } catch { return '当前页面不支持'; } })();
  for (const id of ['discover','video','current-capture']) $(id).disabled = !siteState.supported || siteState.blocked || (id === 'current-capture' && galleryBusy);
  for (const id of ['capture','capture-region','article']) $(id).disabled = !siteState.supported;
  $('gallery-capture').disabled = galleryBusy || (siteState.supported && siteState.blocked && !siteState.automatic);
  $('site-toggle').disabled = !siteState.supported || siteState.automatic;
  $('site-toggle').setAttribute('aria-pressed', String(siteState.blocked));
  $('site-toggle').textContent = !siteState.supported ? '不适用于此页面' : siteState.automatic ? '自动停用' : siteState.blocked ? (siteState.direct.length ? '恢复此网址' : '管理黑名单') : '禁用此网址';
  $('site-status').textContent = !siteState.supported ? '仅支持 HTTP(S) 网页' : siteState.automatic ? '知识库页面自动停用嗅探' : siteState.blocked ? '本站预览与嗅探已停用' : '本站采集已开启';
}
renderSite();
$('site-toggle').onclick = async () => {
  if (siteState.blocked && !siteState.direct.length) return chrome.runtime.openOptionsPage();
  try { const next = toggleSiteBlock(tab.url, config); await chrome.storage.local.set({blockedSites:next.blockedSites}); config = await settings(); renderSite(); }
  catch (error) { $('site-status').textContent = error.message; }
};
async function connect() {
  if(config.saveAction==='download')return;
  $('destination').disabled = true; $('connection-retry').hidden = true;
  if (!config.token) { $('connection-state').textContent = '尚未连接知识库，预览与下载仍可使用'; return; }
  $('connection-state').textContent = '正在读取知识库…';
  try {
    const collections = await api('/api/collections', {signal:AbortSignal.timeout(8000)}, config);
    $('destination').replaceChildren(new Option('未分类',''), ...collections.map(c => new Option(c.name,c.id)));
    if (config.collection_id && !collections.some(c => c.id === config.collection_id)) {const missing=new Option('原知识库已删除，请重新选择',config.collection_id);missing.disabled=true;$('destination').append(missing);$('destination').value=config.collection_id;throw Error('原目标知识库已删除，请重新选择');}
    $('destination').value = config.collection_id; $('connection-state').textContent = '';
  } catch (error) { $('connection-state').textContent = error.message; $('connection-retry').hidden = false; }
  finally { $('destination').disabled = $('destination').options.length <= 1 && !!$('connection-state').textContent; }
}
$('destination').onchange = async () => {
  const previous = config.collection_id;
  try { await chrome.storage.local.set({collection_id:$('destination').value}); config = await settings(); $('connection-state').textContent = ''; }
  catch (error) { $('destination').value = previous; $('connection-state').textContent = error.message; }
};
$('connection-retry').onclick = async () => { config=await settings(); await connect(); };
connect();
function saveFeedback(message, error = false) { $('last-task').hidden=false; $('last-task').dataset.state=error?'failed':'completed'; $('status').textContent=message; selectPanel('tasks-panel'); updateCount(); }
async function message(type, extra={}) { const result=await chrome.runtime.sendMessage({type,tabId:tab?.id,...extra}); if(!result?.ok)throw Error(result?.error||'操作失败，请重试');return result; }
async function captureWork(text) {
  if(galleryBusy)return; galleryBusy=true; renderSite();
  $('gallery-task').hidden=false; $('gallery-status').textContent='正在提交作品采集…'; $('gallery-open').hidden=true; selectPanel('tasks-panel');
  try { const result=await message('gallery',{text}); jobs.delete('captures'); await refreshTasks(true); if(!result.job)throw Error('服务器没有返回采集任务');if(result.job.kind==='download')$('gallery-task').hidden=true; }
  catch(error){$('gallery-task').dataset.state='failed';$('gallery-status').textContent=error.message;}
  finally{galleryBusy=false;renderSite();updateCount();}
}
$('current-capture').onclick=()=>captureWork(tab?.url||'');
$('gallery-capture').onclick=()=>captureWork($('gallery-link').value.trim());
$('discover').onclick=async()=>{try{await message('open-panel');window.close();}catch(e){saveFeedback(e.message,true);}};
$('article').onclick=()=>{chrome.tabs.create({url:chrome.runtime.getURL('article.html')+'?tab='+tab.id});window.close();};
$('capture-region').onclick=async()=>{ $('capture-region').disabled=true;try{await message('capture-region-start');window.close();}catch(e){saveFeedback(e.message,true);}finally{renderSite();}};
$('capture').onclick=async()=>{ $('capture').disabled=true;saveFeedback('正在截图并上传…');try{await message('capture');await refreshTasks(true);}catch(e){saveFeedback(e.message,true);}finally{renderSite();}};
$('video').onclick=async()=>{ $('video').disabled=true;selectPanel('tasks-panel');$('video-task').hidden=false;$('video-status').textContent='正在提交视频采集…';try{const result=await message('video');jobs.delete('imports');await refreshTasks(true);if(result.job?.kind==='download')$('video-task').hidden=true;}catch(e){$('video-status').textContent=e.message;$('video-task').dataset.state='failed';}finally{renderSite();updateCount();}};
const running=job=>['queued','running'].includes(job?.status);
async function task(kind, ref, force) {
  const prefix=kind==='captures'?'gallery':'video', card=$(prefix+'-task');
  if(!ref||serverUrl(config.server)!==serverUrl(ref.server)){card.hidden=true;jobs.delete(kind);refs.delete(kind);return;}
  card.hidden=false;const previous=refs.get(kind);refs.set(kind,ref);
  if(!force&&previous?.id===ref.id&&jobs.has(kind)&&!running(jobs.get(kind)))return;
  try{
    const job=await api('/api/'+kind+'/'+ref.id,{signal:AbortSignal.timeout(8000)},config);jobs.set(kind,job);
    card.dataset.state=job.status;$(prefix+'-status').textContent=job.message;
    $(prefix+'-open').hidden=job.status!=='completed'||!job.item_id;
    if(job.item_id)$(prefix+'-open').href=serverUrl(config.server)+'/#item/'+encodeURIComponent(job.item_id);
    $(prefix+'-retry').hidden=!['failed','cancelled'].includes(job.status);
    if(kind==='imports')$('cancel-video').hidden=!running(job);
  }catch(e){$(prefix+'-status').textContent=e.message;card.dataset.state='failed';$(prefix+'-open').hidden=true;$(prefix+'-retry').hidden=false;if(kind==='imports')$('cancel-video').hidden=true;}
}
for(const [kind,prefix] of [['captures','gallery'],['imports','video']])$(prefix+'-retry').onclick=async()=>{
  const ref=refs.get(kind);if(!ref)return;
  $(prefix+'-retry').disabled=true;
  try{const previous=jobs.get(kind);if(previous&&['failed','cancelled'].includes(previous.status))await api('/api/'+kind+'/'+ref.id+'/retry',{method:'POST'},config);jobs.delete(kind);await refreshTasks(true);}catch(e){$(prefix+'-status').textContent=e.message;}finally{$(prefix+'-retry').disabled=false;}
};
$('cancel-video').onclick=async()=>{const ref=refs.get('imports');if(!ref)return;try{await api('/api/imports/'+ref.id,{method:'DELETE'},config);await refreshTasks(true);}catch(e){$('video-status').textContent=e.message;}};
function updateCount(){const count=[...jobs.values()].filter(job=>running(job)||job.status==='failed').length+document.querySelectorAll('#media-task-list [data-state=running],#media-task-list [data-state=failed]').length;$('task-count').textContent=count;$('task-count').hidden=!count;$('tasks-empty').hidden=[...document.querySelectorAll('#tasks-panel .task-card')].some(card=>!card.hidden);}
async function refreshTasks(force=false){
  if(taskLoading){if(force)refreshQueued=true;return;}taskLoading=true;
  try{
    const local=await chrome.storage.local.get(['lastResult','lastCapture','lastImport']);
    if(local.lastResult){$('last-task').hidden=false;$('status').textContent=local.lastResult.message;$('last-task').dataset.state=local.lastResult.ok?'completed':'failed';$('open').hidden=!local.lastResult.ok||!local.lastResult.itemId;if(local.lastResult.itemId)$('open').href=serverUrl(config.server)+'/#item/'+encodeURIComponent(local.lastResult.itemId);}
    await Promise.allSettled([task('captures',local.lastCapture,force),task('imports',local.lastImport,force)]);
    const stored=await chrome.storage.session.get('mediaTasks');$('media-task-list').replaceChildren();
    for(const value of Object.values(stored.mediaTasks||{}).filter(t=>t.tabId===tab?.id).sort((a,b)=>b.updated-a.updated).slice(0,10)){
      const card=document.createElement('article');card.className='task-card';card.dataset.state=value.status;const title=document.createElement('strong'),state=document.createElement('p');title.textContent=value.title||'媒体任务';state.textContent=value.message||value.status;card.append(title,state);
      if(value.itemId){const link=document.createElement('a');link.href=serverUrl(config.server)+'/#item/'+encodeURIComponent(value.itemId);link.target='_blank';link.rel='noreferrer';link.textContent='查看已保存内容 ↗';card.append(link);}if(value.status==='failed'){const retry=document.createElement('button');retry.textContent='回到本页重试';retry.onclick=$('discover').onclick;card.append(retry);}$('media-task-list').append(card);
    }
    updateCount();
  }finally{taskLoading=false;if(refreshQueued){refreshQueued=false;refreshTasks(true);}}
}
refreshTasks(true);const poll=setInterval(()=>refreshTasks(),2000);window.addEventListener('pagehide',()=>clearInterval(poll),{once:true});
chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&['lastCapture','lastImport'].some(key=>key in changes)){jobs.clear();refreshTasks(true);}});
chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes.saveAction)settings().then(value=>{config=value;renderMode();connect();});});
document.querySelector('[data-panel-tabs]').addEventListener('panel-change',e=>{if(e.detail==='tasks-panel')refreshTasks();});
for(const [id,key] of [['quick-hover','hover'],['quick-dock','dock']]){
  $(id).checked=config[key]!==false;$(id).onchange=async()=>{try{await chrome.storage.local.set({[key]:$(id).checked});config=await settings();$('plugin-status').textContent='已保存，当前网页同步生效';}catch(e){$(id).checked=config[key]!==false;$('plugin-status').textContent=e.message;}};
}
$('settings').onclick=()=>chrome.runtime.openOptionsPage();
$('library-open').onclick=()=>chrome.tabs.create({url:serverUrl(config.server)});
document.body.dataset.ready='true';
