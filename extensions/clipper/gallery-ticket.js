import {settings,serverUrl} from './client.js';

export async function openGallery(group, sender, action = 'download') {
  if (!['download', 'save'].includes(action)) throw Error('未知批量操作');
  const page = new URL(sender.url), source = new URL(group?.source_url);
  if (!/^https?:$/.test(page.protocol) || source.origin !== page.origin || source.username || source.password || source.href.length>4096 || (group.page_url||group.source_url)!==page.href || !Array.isArray(group.images) || group.images.length < 2 || group.images.length > 200) throw Error('作品图片组无效，请刷新网页后重试');
  const images = [...new Set(group.images.map(value => {
    if(typeof value!=='string' || value.length>4096)throw Error('图片地址无效');
    const url = new URL(value); if(!/^https?:$/.test(url.protocol)||url.username||url.password)throw Error('图片地址无效');return url.href;
  }))];
  const previews=images.map(url=>{
    try{const value=group.previews?.[group.images.indexOf(url)],u=new URL(value);return /^https?:$/.test(u.protocol)&&!u.username&&!u.password&&u.href.length<=4096?u.href:url;}catch{return url;}
  });
  const saved = await chrome.storage.session.get(null);
  const old = Object.entries(saved).filter(([key])=>key.startsWith('gallery-')).sort((a,b)=>b[1].created-a[1].created);
  if(action==='save'){
    const existing=old.find(([,item])=>item.action==='save'&&item.inline&&item.owner?.tab===sender.tab?.id&&item.owner?.frame===(sender.frameId||0)&&item.source_url===source.href&&JSON.stringify(item.images)===JSON.stringify(images)&&item.busy);
    if(existing)return {id:existing[0].slice(8),inline:true,message:'已展开正在入库的作品'};
  }
  const removable=old.filter(([,item])=>!item.busy);
  if(old.length>=10&&!removable.length)throw Error('已有 10 个作品正在处理，请等待其中一个完成');
  await chrome.storage.session.remove(removable.filter(([,item],i)=>i>=Math.max(0,9-(old.length-removable.length))||Date.now()-item.created>86400000).map(([key])=>key));
  const id = crypto.randomUUID();
  const config=action==='save'?await settings():null;
  const initialTarget=config?{server:serverUrl(config.server),collection_id:config.collection_id,tags:config.tags}:undefined;
  await chrome.storage.session.set({['gallery-'+id]:{images,previews,action,title:String(group.title||'作品图片').slice(0,180),source_url:source.href,created:Date.now(),...(action==='save'?{inline:true,autoStart:true,initialTarget,owner:{tab:sender.tab.id,frame:sender.frameId||0,origin:page.origin}}:{})}});
  if(action==='save')return {id,inline:true,message:'正在保存到上次选择的知识库'};
  await chrome.tabs.create({url:chrome.runtime.getURL('gallery.html')+'?id='+id});
  return {message:'已打开作品批量下载'};
}

export async function inlineGalleryTicket(sender){
  const url=new URL(sender.url),id=url.searchParams.get('id');
  if(url.origin!==new URL(chrome.runtime.getURL('batch.html')).origin||url.pathname!=='/batch.html'||!id||!sender.tab)throw Error('请从原网页打开批量入库');
  return navigator.locks.request('gallery-start:'+id,async()=>{
  const group=(await chrome.storage.session.get('gallery-'+id))['gallery-'+id];
  if(!group?.inline||group.owner?.tab!==sender.tab.id||Date.now()-group.created>86400000)throw Error('入库任务已过期，请从原网页重新打开');
  // webNavigation omits extension-origin child frames. Validate the originating
  // web frame and tab instead, and reject opening the task as a top-level page.
  const parent=await chrome.webNavigation.getFrame({tabId:sender.tab.id,frameId:group.owner.frame});
  if(sender.frameId===0||!parent||new URL(parent.url).origin!==group.owner.origin)throw Error('请在创建任务的网页中继续入库');
  // Consume the user-created start intent once, before the frame does network I/O.
  // Reopening/reloading failed or stopped tasks never starts another upload.
  const startNow=group.autoStart===true;
  if(startNow){group.autoStart=false;await chrome.storage.session.set({['gallery-'+id]:group});}
  return {id,group,startNow};
  });
}

export async function pendingInlineGalleries(sender){
  const origin=new URL(sender.url).origin,saved=await chrome.storage.session.get(null);
  return Object.entries(saved).filter(([key,g])=>key.startsWith('gallery-')&&g.inline&&g.owner?.tab===sender.tab.id&&g.owner.frame===(sender.frameId||0)&&g.owner.origin===origin&&Date.now()-g.created<=86400000&&g.saveTarget&&g.images.some((_,i)=>!['done','duplicate'].includes(g.saveStates?.[i]))).sort((a,b)=>a[1].created-b[1].created).slice(-10).map(([key])=>({id:key.slice(8)}));
}
