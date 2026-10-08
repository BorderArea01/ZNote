import { saveImage, limitedImage, api, settings } from './client.js';
import { blockedSite } from './site-policy.js';
const assertSiteAllowed = (url, config) => {
  if (blockedSite(url, config)) throw new Error('此网站已停用 ZNote 媒体采集，可在扩展弹窗或设置中恢复');
};
export async function record(operation) {
  await chrome.action.setBadgeText({ text: '…' });
  try {
    const item = await operation();
    await chrome.storage.local.set({ lastResult: { ok: true, message: item.duplicate ? '此知识库已收录，已补充来源' : '已保存到知识库', itemId: item.id, time: Date.now() } });
    await chrome.action.setBadgeBackgroundColor({ color: '#5865ce' }); await chrome.action.setBadgeText({ text: '✓' });
    return item;
  } catch (error) {
    await chrome.storage.local.set({ lastResult: { ok: false, message: error.message, time: Date.now() } });
    await chrome.action.setBadgeBackgroundColor({ color: '#af453e' }); await chrome.action.setBadgeText({ text: '!' });
    throw error;
  }
}
export async function collectImage(info, tab, preferOriginal = true) {
  const config = await settings();
  assertSiteAllowed(info.pageUrl || tab?.url, config);
  let candidates = [];
  if (preferOriginal) {
    try { candidates = await chrome.tabs.sendMessage(tab.id, { type: 'image-candidates', srcUrl: info.srcUrl }, { frameId: info.frameId || 0 }); } catch {}
  }
  const urls = [...new Set([...(Array.isArray(candidates) ? candidates.map(c => c.url) : []), info.srcUrl])];
  let lastError;
  for (const url of urls) {
    let image;
    try { image = await limitedImage(url); } catch (e) { lastError = e; continue; }
    let filename; try { if (/^https?:/i.test(url)) filename = decodeURIComponent(new URL(url).pathname.split('/').pop()); } catch {}
    try {
      return await saveImage(image, { filename: filename || '网页图片.png', title: info.selectionText || filename || tab?.title || '网页图片', image_url: /^https?:/i.test(url) ? url : undefined, source_url: info.pageUrl || tab?.url,
        capture_note: preferOriginal ? (url !== info.srcUrl ? '已从网页提供的高清候选地址采集，未放大或重新编码。' : '未获得可用的更高清版本，已保存当前图片。') : '已保存当前图片。' }, undefined, config);
    } catch (e) { if (e.status !== 415) throw e; lastError = e; }
  }
  throw lastError || new Error('无法读取图片，可改用页面截图');
}
export async function capturePage(tab, region = null) {
  const [active] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
  if (active?.id !== tab.id) throw new Error('当前标签页已经改变，请重新点击截图');
  await chrome.tabs.sendMessage(tab.id,{type:'prepare-page-screenshot'},{frameId:0}).catch(()=>{});
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    let blob = await (await fetch(dataUrl)).blob();
    if (region) blob = await cropScreenshot(blob, region);
    return await saveImage(blob, { title: `${tab.title || '网页'} · ${region?'区域截图':'截图'}`, filename: region?'区域截图.png':'页面截图.png', source_url: tab.url, capture_note: region?'手动框选的页面截图':'当前页面可见区域截图' });
  } finally {await chrome.tabs.sendMessage(tab.id,{type:'restore-page-screenshot'},{frameId:0}).catch(()=>{});}
}
export async function cropScreenshot(blob, region) {
  const { x, y, width, height, viewportWidth, viewportHeight } = region;
  if (![x,y,width,height,viewportWidth,viewportHeight].every(Number.isFinite) || x<0 || y<0 || width<8 || height<8 || viewportWidth<=0 || viewportHeight<=0 || x+width>viewportWidth+1 || y+height>viewportHeight+1) throw Error('截图区域无效，请重新框选');
  const image=await createImageBitmap(blob);
  try {
    const scaleX=image.width/viewportWidth, scaleY=image.height/viewportHeight;
    if(Math.abs(scaleX-scaleY)>0.05)throw Error('页面尺寸已改变，请重新框选');
    const left=Math.round(x*scaleX),top=Math.round(y*scaleY),w=Math.min(image.width-left,Math.round(width*scaleX)),h=Math.min(image.height-top,Math.round(height*scaleY));
    const canvas=new OffscreenCanvas(w,h);canvas.getContext('2d').drawImage(image,left,top,w,h,0,0,w,h);
    return await canvas.convertToBlob({type:'image/png'});
  } finally { image.close(); }
}
export async function captureRegion(tab) {
  let selected;
  try { selected=await chrome.tabs.sendMessage(tab.id,{type:'select-capture-region'},{frameId:0}); }
  catch { throw Error('此页面尚不能框选截图，请刷新网页后重试'); }
  return finishCaptureRegion(tab,selected);
}
export async function startCaptureRegion(tab) {
  let result;
  try{result=await chrome.tabs.sendMessage(tab.id,{type:'select-capture-region-start'},{frameId:0});}
  catch{throw Error('此页面尚不能框选截图，请刷新网页后重试');}
  if(!result?.ok)throw Error(result?.error||'框选界面未能打开，请刷新网页后重试');
  return {started:true};
}
export async function finishCaptureRegion(tab,selected) {
  if(selected?.cancelled)return {cancelled:true};
  if(!selected?.region)throw Error(selected?.error||'未选择截图区域');
  const current=await chrome.tabs.get(tab.id);
  if(current.url!==selected.source_url)throw Error('页面已切换，请重新框选');
  await chrome.tabs.sendMessage(tab.id,{type:'region-capture-result',message:'正在保存截图…'},{frameId:0}).catch(()=>{});
  try {
    const item=await record(()=>capturePage(current,selected.region));
    await chrome.tabs.sendMessage(tab.id,{type:'region-capture-result',message:'区域截图已保存到知识库'},{frameId:0}).catch(()=>{});
    return item;
  } catch(e) {
    await chrome.tabs.sendMessage(tab.id,{type:'region-capture-result',message:e.message||'截图保存失败，可重新框选重试'},{frameId:0}).catch(()=>{});throw e;
  }
}
export async function collectVideo(tab, url = tab.url) {
  const config = await settings();
  assertSiteAllowed(tab?.url, config);
  try {
    const job = await api('/api/imports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, collection_id: config.collection_id || null, tags: config.tags.split(/[,，]/).map(t => t.trim()).filter(Boolean) }) });
    // The server owns long downloads; closing the popup or suspending the worker is safe.
    await chrome.storage.local.set({ lastImport: { id: job.id, server: serverUrlForJob(config.server) } });
    await chrome.action.setBadgeText({ text: '…' });
    return job;
  } catch (e) {
    await chrome.storage.local.set({ lastResult: { ok: false, message: e.message, time: Date.now() } });
    await chrome.action.setBadgeText({ text: '!' }); throw e;
  }
}
export async function collectGallery(tab, text = tab?.url, { dedupe = false, browserHtml = '' } = {}) {
  try {
    const config = await settings();
    const value = String(text || '').trim();
    if (!value) throw new Error('请粘贴作品链接或先打开作品页面');
    const source = value.match(/https?:\/\/[^\s<>"\u200b]+/i)?.[0] || value;
    assertSiteAllowed(source, config);
    if (!browserHtml && tab?.id && /^https:\/\/www\.xiaohongshu\.com\/(?:explore|discovery\/item)\/[a-f\d]+(?:[/?#]|$)/i.test(source)) {
      // Reuse the logged-in page's complete work data for the popup and link
      // entry as well as the per-post button. Server-only HTML can be gated.
      const result = await chrome.tabs.sendMessage(tab.id, { type: 'post-capture-page', url: source }, { frameId: 0 }).catch(() => null);
      if (result?.ok) browserHtml = result.pageHtml || '';
    }
    const requestId = dedupe
      ? `clipper-${/^https:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\//.test(source)?'x':/^https:\/\/www\.xiaohongshu\.com\//.test(source)?'xhs':'work'}-${Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${source}\n${config.collection_id || ''}`)))).map(byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 32)}`
      : `clipper-gallery-${crypto.randomUUID()}`;
    let job = await api('/api/captures', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: value,
        image_mode: 'group',
        ...(['original','compress'].includes(config.largeImageDefault) ? { image_size_mode:config.largeImageDefault } : {}),
        collection_id: config.collection_id || null,
        tags: config.tags.split(/[,，]/).map(t => t.trim()).filter(Boolean),
        request_id: requestId,
        ...(browserHtml ? { browser_html: browserHtml } : {}),
      }),
    });
    if (dedupe && job.status === 'failed') job = await api(`/api/captures/${job.id}/retry`, { method: 'POST' });
    await chrome.storage.local.set({ lastCapture: { id: job.id, server: serverUrlForJob(config.server), time: Date.now() } });
    await chrome.action.setBadgeText({ text: '…' });
    return job;
  } catch (e) {
    await chrome.storage.local.set({ lastResult: { ok: false, message: e.message, time: Date.now() } });
    await chrome.action.setBadgeText({ text: '!' });
    throw e;
  }
}
const serverUrlForJob = value => value.replace(/\/$/, '');
