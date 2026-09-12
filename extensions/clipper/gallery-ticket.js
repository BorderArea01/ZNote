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
  await chrome.storage.session.remove(old.filter(([,item],i)=>i>=9||Date.now()-item.created>86400000).map(([key])=>key));
  const id = crypto.randomUUID();
  await chrome.storage.session.set({['gallery-'+id]:{images,previews,action,title:String(group.title||'作品图片').slice(0,180),source_url:source.href,created:Date.now()}});
  await chrome.tabs.create({url:chrome.runtime.getURL('gallery.html')+'?id='+id});
  return {message:action==='save'?'请选择知识库后保存整组图片':'已打开作品批量下载'};
}
