(() => {
  const send = (message) =>
    chrome.runtime.sendMessage(message).then((result) => {
      if (!result?.ok)
        throw new Error(result?.error || "扩展连接已失效，请刷新页面");
      return result.value;
    });
  let host,
    root,
    inlineGallery,
    dock,
    panel,
    preview,
    previewImage,
    previewLabel,
    status,
    list,
    selector,
    tagInput,
    enabled = false,
    resources = [],
    hovered = null,
    hoverURL = "",
    hoverToken = 0,
    hoverBusy = false,
    hoverTimer,
    pendingTarget,
    downloadButton,
    saveButton,
    groupBar, groupCounter, previousButton, nextButton, batchButton, batchSaveButton,
    imageGroup = null, groupIndex = 0, requestedIndex = 0, pageToken = 0, pageBusy = false, lastWheel = 0,
    previewCache, originalButton, groupLoading=false, failedIndex=null,
    downloadKey = 's',
    saveKey = 'z',
    previewWidth = 720,
    sizeInput,
    hideTimer,
    hideDelay,
    pointer = { x: -1, y: -1 },
    pollTimer,
    hoverAllowed = false,
    dockAllowed = false,
    siteBlocked = true,
    renderedCards = new Map(),
    scanTimer, scanInFlight, scanQueued=false, lastScan=0;
  const own = (event) => event.composedPath().includes(host);
  const shortcutHelp = () => `${downloadKey.toUpperCase()} 下载 · ${saveKey.toUpperCase()} 入库`;
  async function refreshSettings() {
    try {
      const config = await send({type: 'media-settings',znotePage:!!document.querySelector('meta[name="znote-app"]')});
      hoverAllowed = config.hover; dockAllowed = config.dock;
      siteBlocked = config.blocked;
      if(siteBlocked){enabled=false;resources=[];panel.classList.add('hidden');clearInterval(pollTimer);globalThis.ZNoteDouyinObserve?.(false);}
      downloadKey = /^[a-z0-9]$/.test(config.downloadKey) ? config.downloadKey : 's';
      saveKey = /^[a-z0-9]$/.test(config.saveKey) && config.saveKey !== downloadKey ? config.saveKey : (downloadKey === 'z' ? 's' : 'z');
      downloadButton.textContent = `${downloadKey.toUpperCase()} 下载`;
      saveButton.textContent = `${saveKey.toUpperCase()} 保存知识库`;
      previewLabel.textContent = shortcutHelp();
      previewWidth = Math.max(240, Math.min(1200, Number(config.previewWidth) || 720));
      sizeInput.value = previewWidth;
      placePreview();
      dock.classList.toggle('hidden', !dockAllowed || window !== top);
      if (!hoverAllowed) hide();
    } catch {}
  }
  const element = (tag, text, attrs = {}) => {
    const el = document.createElement(tag);
    if (text) el.textContent = text;
    for (const [key, value] of Object.entries(attrs))
      el.setAttribute(key, value);
    return el;
  };
  const button = (text, fn) => {
    const el = element("button", text, { type: "button" });
    el.addEventListener("click", (e) => {
      if (e.isTrusted) fn(e);
    });
    return el;
  };
  const css = `:host{all:initial;font:13px/1.55 system-ui,'Microsoft YaHei',sans-serif;color:#ecedf6}*{box-sizing:border-box}button,select,input{font:inherit}button{cursor:pointer;color:inherit;background:#2a3040;border:1px solid #404b65;border-radius:9px;padding:7px 11px}button:hover{background:#404b65}button:disabled{opacity:.5;cursor:wait}button:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid #a8b5d3}button.primary{background:#5865ce;border-color:#808def}.dock{backdrop-filter:blur(18px);position:fixed;right:18px;bottom:24px;border:1px solid #a8b5d3;border-radius:24px;background:#1c202b;color:#ecedf6;box-shadow:0 5px 28px #0005;z-index:2147483647;padding:11px 16px;touch-action:none}.panel{position:fixed;right:18px;bottom:80px;width:min(414px,calc(100vw - 24px));max-height:min(710px,calc(100vh - 108px));display:flex;flex-direction:column;background:#14171f;color:#ecedf6;border:1px solid #404b65;border-radius:16px;box-shadow:0 12px 44px #0007;z-index:2147483647;overflow:hidden}.head,.controls,.destination{padding:12px 14px;border-bottom:1px solid #2a3040}.head{display:flex;align-items:center;justify-content:space-between;font-weight:650}.head small{font-size:11px;color:#a8b5d3;font-weight:400}.controls{display:flex;gap:6px;flex-wrap:wrap}.controls button[aria-pressed=true]{background:#404b65}.destination{display:grid;grid-template-columns:1fr 1fr;gap:8px}.destination input,.destination select{width:100%;min-width:0;border:1px solid #404b65;border-radius:7px;background:#1c202b;color:inherit;padding:6px}.destination label{font-size:11px}.list{overflow:auto;min-height:70px;padding:9px 12px;overscroll-behavior:contain}.item{padding:11px 0;border-bottom:1px solid #2a3040}.row{display:flex;gap:10px;align-items:center}.thumb{width:66px;height:48px;object-fit:cover;border-radius:6px;background:#2a3040}.info{min-width:0;flex:1}.title{display:block;white-space:nowrap;text-overflow:ellipsis;overflow:hidden;font-size:12px}.meta{display:block;color:#a8b5d3;font-size:11px;word-break:break-all}.actions{display:flex;gap:7px;margin-top:9px}.footer{padding:10px 14px;color:#a8b5d3;font-size:11px;border-top:1px solid #2a3040}.status{padding:0 14px 10px;color:#cbd3e8;overflow-wrap:anywhere;font-size:12px}.preview{backdrop-filter:blur(18px);position:fixed;z-index:2147483646;padding:8px;border:1px solid #a8b5d3;border-radius:12px;background:#14171ff5;color:#ecedf6;box-shadow:0 8px 32px #0007;max-width:calc(100vw - 24px);max-height:calc(100vh - 24px);display:flex;flex-direction:column;gap:7px;pointer-events:auto}.preview img{display:block;max-width:min(720px,calc(100vw - 42px));max-height:calc(100vh - 116px);object-fit:contain}.preview .bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.preview small{font-size:11px;color:#cbd3e8}.empty{color:#a8b5d3;padding:15px 2px}.hidden{display:none!important}`;
  const videoCss = '.panel{width:min(440px,calc(100vw - 24px))}.item{padding:14px 2px}.row{align-items:flex-start;gap:12px}.thumb-button{padding:0;width:104px;height:78px;flex:none;overflow:hidden;border:1px solid #384157;border-radius:10px;background:#222735}.thumb{width:100%;height:100%;object-fit:cover;display:block}.thumb-fallback{display:grid;place-items:center;height:100%;color:#b9c5e9;font-size:25px}.title{font-size:13px;line-height:1.5;white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font-weight:600}.author{display:block;margin-top:5px;font-size:12px;color:#c2caf0}.unresolved{margin-top:5px;color:#aaaec0}.variants{width:100%;margin-top:10px;background:#202533;color:#cbd3e8;border:1px solid #384157;border-radius:7px;padding:6px;font:inherit;font-size:11px}.actions{display:grid;grid-template-columns:1fr 1fr 1.5fr;margin-top:11px}.actions button{padding:8px 5px}';
  function notify(text) {
    if (status) status.textContent = text;
  }
  async function act(resource, action, btn) {
    if (btn) btn.disabled = true;
    notify("正在处理…");
    try {
      await scan();
      const result = await send({
        type: "media-action",
        id: resource.id,
        action,
      });
      notify(result.message);
    } catch (e) {
      notify(e.message);
    } finally {
      if (btn) btn.disabled = false;
    }
  }
  const selectedVariants=new Map();
  function draw() {
    if (!list) return;

    const groups=globalThis.ZNoteVideoGroups(resources);
    dock.textContent = '▶ 视频 '+(groups.length||'');
    const retained=new Set();let position=0;
    if(!groups.length){if(!list.querySelector('.empty'))list.replaceChildren(element('p','暂未发现视频。播放视频后自动发现 MP4、WebM 或 m3u8。',{class:'empty'}))}else list.querySelector('.empty')?.remove();
    for(const group of [...groups].reverse()){
      let r=group.items.find(x=>x.id===selectedVariants.get(group.key))||group.primary;
      retained.add(group.key);const signature=JSON.stringify([r.id,group.items]),cached=renderedCards.get(group.key);
      if(cached?.signature===signature){if(list.children[position]!==cached.node)list.insertBefore(cached.node,list.children[position]||null);position++;continue}
      cached?.node.remove();
      const item=element('article',null,{class:'item','data-resource-id':r.id,'data-work-id':r.work_id||''});
      const row=element('div',null,{class:'row'});
      const thumb=button('',()=>act(r,'preview',thumb));thumb.className='thumb-button';thumb.title='预览视频';thumb.setAttribute('aria-label','预览视频封面');
      let frameRequested=false;
      const showFrame=()=>{thumb.replaceChildren(element('span','▶',{class:'thumb-fallback'}));thumb.title=r.kind==='hls'?'点击播放预览':'悬停查看首帧，点击播放预览'};
      const poster=r.poster||group.items.find(x=>x.poster)?.poster;
      if(poster){const img=element('img',null,{class:'thumb',alt:r.title+' 封面',loading:'lazy',referrerpolicy:'no-referrer'});img.src=poster;img.addEventListener('error',showFrame,{once:true});thumb.append(img)}else showFrame();
      const requestFrame=async()=>{if(frameRequested||thumb.querySelector('img')||r.kind==='hls')return;frameRequested=true;const image=await globalThis.ZNoteVideoThumbnail?.(r.url);if(!image)frameRequested=false;if(image&&thumb.isConnected){const img=element('img',null,{class:'thumb',alt:'视频首帧'});img.src=image;thumb.replaceChildren(img)}};
      thumb.addEventListener('pointerenter',requestFrame);thumb.addEventListener('focus',requestFrame);
      const info=element('div',null,{class:'info'});info.append(element('strong',r.title||'未识别标题',{class:'title',title:r.title||''}));
      info.append(element('span',r.author?'作者：'+r.author:'作者待识别',{class:r.author?'author':'meta unresolved'}));
      info.append(element('span',(r.kind==='hls'?'m3u8 分段视频':'视频文件')+(group.items.length>1?' · '+group.items.length+' 条线路':'')+(r.bytes?' · '+(r.bytes/1024/1024).toFixed(1)+' MB':''),{class:'meta'}));
      row.append(thumb,info);item.append(row);
      if(group.items.length>1){
        const choices=element('select',null,{class:'variants','aria-label':'视频线路'});
        group.items.forEach((variant,index)=>{const option=new Option('线路 '+(index+1)+' · '+new URL(variant.url).hostname,variant.id);choices.append(option)});choices.value=r.id;
        choices.addEventListener('change',()=>{selectedVariants.set(group.key,choices.value);draw()});item.append(choices);
      }
      const actions=element('div',null,{class:'actions'});
      for(const [label,action]of [['预览','preview'],['下载','download'],['保存知识库','save']]){const btn=button(label,()=>act(r,action,btn));if(action==='save')btn.classList.add('primary');actions.append(btn)}
      item.append(actions);list.insertBefore(item,list.children[position]||null);position++;renderedCards.set(group.key,{signature,node:item});
    }
    for(const [key,entry]of renderedCards)if(!retained.has(key)){entry.node.remove();renderedCards.delete(key);selectedVariants.delete(key)}
  }
  const recentMedia=new Map();
  const rememberMedia=entry=>{if(!entry?.name)return;const interesting=/\.(mp4|webm|mov|m3u8)(?:$|[?#])/i.test(entry.name)||/^https?:\/\/[^/]*\.(douyinvod|douyinstatic)\.com\//i.test(entry.name);if(!interesting)return;recentMedia.delete(entry.name);recentMedia.set(entry.name,entry);while(recentMedia.size>200)recentMedia.delete(recentMedia.keys().next().value);return true};
  function scheduleScan(){if(!enabled||siteBlocked||document.hidden||scanTimer)return;scanTimer=setTimeout(()=>{scanTimer=null;runScan()},Math.max(250,750-(performance.now()-lastScan)))}
  function scan(){globalThis.ZNoteDouyinRefresh?.();return runScan()}
  function runScan(){
    if(!enabled||siteBlocked||document.hidden)return;
    clearTimeout(scanTimer);scanTimer=null;
    if(scanInFlight){scanQueued=true;return scanInFlight}
    lastScan=performance.now();scanInFlight=Promise.resolve(performScan()).finally(()=>{scanInFlight=null;if(scanQueued){scanQueued=false;scheduleScan()}});return scanInFlight;
  }
  function performScan() {
    if (!enabled || siteBlocked) return;
    globalThis.ZNoteDouyinObserve?.(true);
    const found = [];
    const videos=[...document.querySelectorAll('video')];
    const active=videos.filter(v=>!v.paused&&v.getBoundingClientRect().width>0);
    const primary=active.length===1?active[0]:videos.length===1?videos[0]:null;
    const metadata=videos.length<=1||primary?globalThis.ZNoteVideoMetadata(primary):{title:document.title};
    const networkMetadata=/(^|\.)(douyin|iesdouyin)\.com$/.test(location.hostname)?{title:metadata.title,source_url:metadata.source_url}:metadata;
    for (const video of videos) {
      const details=globalThis.ZNoteVideoMetadata(video);
      for(const url of [video.currentSrc,video.src,...[...video.querySelectorAll('source')].map(s=>s.src)])
        if (/^https?:/.test(url))found.push({...details,...globalThis.ZNoteDouyinMetadataForUrl?.(url),url,kind:'video'});
    }
    for(const resource of resources){const details=globalThis.ZNoteDouyinMetadataForUrl?.(resource.url);if(details)found.push({...details,url:resource.url,kind:resource.kind,mime:resource.mime})}
    for (const r of recentMedia.values()) {
      const details=globalThis.ZNoteDouyinMetadataForUrl?.(r.name);
      if(details||/\.(mp4|webm|mov|m3u8)(?:$|[?#])/i.test(r.name))found.push({...networkMetadata,metadata_rank:1,...details,url:r.name,...(details?{kind:'video'}:{})});
    }
    return send({ type: 'media-scan', resources: found.slice(0,200), metadata:networkMetadata })
      .then((state) => {
        resources = state.resources;
        draw();
      })
      .catch((e) => notify(e.message));
  }
  async function open() {
    await refreshSettings();
    if(siteBlocked)return;
    panel.classList.remove("hidden");
    for(const entry of performance.getEntriesByType('resource').slice(-300))rememberMedia(entry);
    preview.classList.add("hidden");
    try {
      const state = await send({ type: "media-start" });
      enabled = state.enabled;
      resources = state.resources;
      scan();
      draw();
    } catch (e) {
      notify(e.message);
    }
    clearTimeout(pollTimer);
    poll();
    try {
      const config = await send({ type: "media-connect" });
      selector.replaceChildren(
        new Option("未分类", ""),
        ...config.collections.map((c) => new Option(c.name, c.id)),
      );
      selector.value = config.collection_id;
      tagInput.value = config.tags;
      notify('悬停大图：' + shortcutHelp());
    } catch (e) {
      notify("下载与预览可直接使用；入库请先点“连接设置”。");
    }
  }
  async function poll() {
    clearTimeout(pollTimer);
    if (panel.classList.contains("hidden")||document.hidden) return;
    try {
      const state = await send({ type: "media-list" });
      if (JSON.stringify(state.resources) !== JSON.stringify(resources)) {
        resources = state.resources;
        draw();
        scheduleScan();
      }
    } catch (e) {
      notify(e.message);
    }
    pollTimer = setTimeout(poll, 1500);
  }
  function closePanel(){panel.classList.add("hidden");clearTimeout(pollTimer);globalThis.ZNoteVideoThumbnailCancel?.()}
  function hide() {
    clearTimeout(hoverTimer); clearTimeout(hideTimer); hideTimer = null; pendingTarget = null;
    preview.classList.add("hidden");
    hovered = null;
    hoverURL = "";
    hoverToken++;
    pageToken++; previewCache?.clear(); imageGroup = null; pageBusy = false; groupLoading=false;failedIndex=null;drawGroup();
  }
  function inPreviewBridge() {
    if (!hovered || preview.classList.contains('hidden')) return false;
    const a = (hovered.closest('a') || hovered).getBoundingClientRect(), b = preview.getBoundingClientRect();
    const { x, y } = pointer;
    // Keep the narrow gap between the source and controls traversable without
    // delaying dismissal everywhere else on the page.
    if (a.right <= b.left || b.right <= a.left) {
      const left = a.right <= b.left ? a : b, right = left === a ? b : a;
      return x >= left.right && x <= right.left && y >= Math.min(a.top, b.top) && y <= Math.max(a.bottom, b.bottom);
    }
    if (a.bottom <= b.top || b.bottom <= a.top) {
      const top = a.bottom <= b.top ? a : b, bottom = top === a ? b : a;
      return y >= top.bottom && y <= bottom.top && x >= Math.min(a.left, b.left) && x <= Math.max(a.right, b.right);
    }
    return false;
  }
  function scheduleHide() {
    const delay = inPreviewBridge() ? 650 : 150;
    if (hideTimer && hideDelay === delay) return;
    clearTimeout(hideTimer);
    hideDelay = delay;
    hideTimer = setTimeout(() => {
      hideTimer = null;
      if (!preview.matches(':hover') && !sourceUnderPointer()) hide();
    }, delay);
  }
  function sourceUnderPointer() {
    return !!hovered && globalThis.ZNoteImageTarget({clientX:pointer.x,clientY:pointer.y,composedPath:()=>document.elementsFromPoint(pointer.x,pointer.y)})===hovered;
  }
  function placePreview() {
    if (!hovered || !previewImage.naturalWidth || preview.classList.contains('hidden')) return;
    let rect = hovered.getBoundingClientRect();
    const anchor = hovered.closest('a')?.getBoundingClientRect();
    if (anchor && anchor.width >= rect.width && anchor.height >= rect.height) rect = anchor;
    const controlsHeight = preview.scrollHeight - previewImage.getBoundingClientRect().height + 18;
    const box = globalThis.ZNotePreviewLayout({width:innerWidth,height:innerHeight},rect,{width:previewImage.naturalWidth,height:previewImage.naturalHeight},previewWidth,Math.max(imageGroup?160:118,controlsHeight));
    previewImage.style.width = box.width + 'px'; previewImage.style.height = box.height + 'px';
    previewImage.style.maxWidth = 'none'; previewImage.style.maxHeight = 'none';
    preview.style.width = (box.containerWidth || box.width + 18) + 'px';
    preview.style.left = box.left + 'px'; preview.style.top = box.top + 'px';
    // Full-screen images may leave no free region: let pointer events reach the
    // website through the displayed image, keeping only our controls interactive.
    preview.style.pointerEvents = box.overlaps && !imageGroup ? 'none' : 'auto';
    previewImage.style.pointerEvents = 'none';
  }
  async function showImage(target, x, y) {
    const token = ++hoverToken,
      candidates = globalThis.ZNoteCandidates(target);
    if (!candidates.length) return;
    hovered = target;
    imageGroup = null; pageToken++; previewCache?.clear(); pageBusy = false; groupLoading=false;failedIndex=null;lastWheel=0; drawGroup();
    hoverURL = '';
    preview.classList.add('hidden');
    // Start work metadata in parallel; show the small existing cover immediately
    // on illustration sites instead of downloading a full original first.
    const selectedWork=globalThis.ZNoteWorkLocation?.(target);
    groupLoading=!!selectedWork;
    const groupResult=globalThis.ZNoteWorkImages?.(target).catch(error=>({error}));
    if(selectedWork && target.tagName==='IMG') {
      const current=target.currentSrc||target.src;
      if(current){const i=candidates.findIndex(c=>c.url===current);if(i>=0)candidates.unshift(...candidates.splice(i,1));}
    }
    for (const c of candidates) {
      const img = new Image();
      const loaded = await new Promise((resolve) => {
        const timer = setTimeout(() => resolve(false), 5000);
        img.onload = () => {
          clearTimeout(timer);
          resolve(true);
        };
        img.onerror = () => {
          clearTimeout(timer);
          resolve(false);
        };
        img.referrerPolicy = target.referrerPolicy || 'strict-origin-when-cross-origin';
        img.src = c.url;
      });
      if (token !== hoverToken) return;
      if (!loaded) continue;
      hoverURL = c.url;
      previewImage.referrerPolicy = img.referrerPolicy;
      previewImage.src = c.url;
      previewLabel.textContent = groupLoading?'正在识别作品，稍后可下载完整原图…':`${img.naturalWidth} × ${img.naturalHeight} · ${shortcutHelp()}`;
      preview.classList.remove("hidden");
      previewImage.onload = placePreview;
      placePreview();
      drawGroup();
      requestAnimationFrame(() => { if (token === hoverToken) placePreview(); });
      loadGroup(target, token, groupResult);
      return;
    }
    if (token === hoverToken) { hovered = null; pendingTarget = null; }
  }
  function drawGroup() {
    groupBar.classList.toggle('hidden', !imageGroup || imageGroup.images.length<2);
    const originalIndex=failedIndex??groupIndex;
    originalButton?.classList.toggle('hidden',!imageGroup || (imageGroup.previews?.[originalIndex]||imageGroup.images[originalIndex])===imageGroup.images[originalIndex]);
    if(originalButton)originalButton.disabled=pageBusy||hoverBusy;
    downloadButton.disabled=!hoverURL||groupLoading||pageBusy||hoverBusy;saveButton.disabled=downloadButton.disabled;
    if (!imageGroup) return;
    groupCounter.textContent = `${groupIndex + 1} / ${imageGroup.images.length}`;
    previousButton.disabled = requestedIndex === 0;
    nextButton.disabled = requestedIndex === imageGroup.images.length - 1;
    batchButton.textContent = `批量下载 ${imageGroup.images.length} 张`;
    batchSaveButton.textContent = `批量入库 ${imageGroup.images.length} 张`;
  }
  async function loadGroup(target, token, result) {
    try {
      const group = await result;
      if (!group || token !== hoverToken) return;
      if(group.error)throw group.error;
      if((group.page_url||group.source_url)!==location.href)return;
      // Match originals to scaled Pixiv thumbnails without confusing another work.
      const pixivPage = hoverURL.match(/\/(\d+_p\d+)/)?.[1];
      const index = group.start_index ?? group.images.findIndex(url => url === hoverURL || (pixivPage && url.includes('/' + pixivPage + '.')));
      if(index<0)return;
      imageGroup = group; requestedIndex = groupIndex = index; drawGroup(); placePreview();
      hoverURL=group.images[index];
      turnPage(0);
    } catch(e) { if(token===hoverToken){previewLabel.textContent = e.message;if(groupLoading)hoverURL='';} }
    finally {if(token===hoverToken){groupLoading=false;drawGroup();}}
  }
  async function turnPage(delta, original=false) {
    if(imageGroup && (imageGroup.page_url||imageGroup.source_url)!==location.href){hide();return;}
    if (!imageGroup || hoverBusy) return;
    const index = requestedIndex + delta;
    if (index < 0 || index >= imageGroup.images.length) return;
    const group = imageGroup, token = ++pageToken, hover = hoverToken;
    requestedIndex=index; failedIndex=null; pageBusy = true; drawGroup(); previewLabel.textContent = `正在加载第 ${index+1} / ${group.images.length} 张${original?'原图':'预览'}…`;
    const url=original?group.images[index]:(group.previews?.[index]||group.images[index]);
    const nearby=[index-1,index+1].filter(i=>i>=0&&i<group.images.length&&group.previews?.[i]&&group.previews[i]!==group.images[i]).map(i=>group.previews[i]);
    previewCache.retain([url,...nearby]);
    let img;
    try {img=await previewCache.get(url);}catch{}
    if(token!==pageToken || hover!==hoverToken)return;
    pageBusy = false;
    if(img) {
      groupIndex=index; hoverURL=group.images[index]; previewImage.src=img.src;
      previewLabel.textContent=`${img.naturalWidth} × ${img.naturalHeight} · ${url===hoverURL?'原图':'快速预览'} · 滚轮翻页`;
      previewImage.onload=placePreview; requestAnimationFrame(placePreview);
      for(const next of nearby)previewCache.get(next).catch(()=>{});
    } else {failedIndex=index;requestedIndex=groupIndex;previewLabel.textContent='预览暂时无法加载，可重试或点击“查看原图”';}
    drawGroup();
  }
  async function hoverAction(action) {
    if(imageGroup && (imageGroup.page_url||imageGroup.source_url)!==location.href){hide();return;}
    if (!hoverURL || !hovered || groupLoading || hoverBusy || pageBusy) return;
    hoverBusy = true;
    clearTimeout(hideTimer); hideTimer = null;
    downloadButton.disabled = true; saveButton.disabled = true;
    const url = hoverURL,
      title = imageGroup ? `${imageGroup.title} · ${String(groupIndex+1).padStart(3,'0')}` : hovered.alt || document.title;
    previewLabel.textContent = "正在处理…";
    try {
      const resource = await send({ type: "hover-resource", url, title, source_url: imageGroup?.source_url || globalThis.ZNoteSourceLink(hovered) });
      const result = await send({
        type: "media-action",
        id: resource.id,
        action,
      });
      previewLabel.textContent = result.message;
      if (preview.classList.contains('hidden')) notify(result.message);
    } catch (e) {
      previewLabel.textContent = e.message;
      if (preview.classList.contains('hidden')) notify(e.message);
    } finally {
      hoverBusy = false;
      downloadButton.disabled = false; saveButton.disabled = false;
      if (!preview.matches(':hover') && !sourceUnderPointer()) scheduleHide();
    }
  }
  async function mount() {
    if (!document.documentElement) return;
    host = element("div", null, { "data-znote-overlay": "true" });
    host.style.setProperty("all", "initial", "important");
    host.style.setProperty("position", "fixed", "important");
    host.style.setProperty("z-index", "2147483647", "important");
    host.style.setProperty("pointer-events", "none", "important");
    document.documentElement.append(host);
    root = host.attachShadow({ mode: "open" });
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css + videoCss + ":host>div,:host>button{pointer-events:auto}");
    root.adoptedStyleSheets = [sheet];
    dock = button("▶ 视频", () =>
      panel.classList.contains("hidden")
        ? open()
        : closePanel(),
    );
    dock.className = "dock";
    dock.setAttribute("aria-label", "ZNote 视频嗅探");
    root.append(dock);
    panel = element("div", null, {
      class: "panel hidden",
      role: "dialog",
      "aria-label": "ZNote 视频嗅探",
    });
    const head = element("div", null, { class: "head" });
    head.append(element("span", "ZNote · 视频嗅探"));
    head.append(button("收起", closePanel));
    panel.append(head);
    const controls = element("div", null, { class: "controls" });
    controls.append(button("扫描", scan));
    const pause = button("暂停嗅探", async () => {
      const state = await send({
        type: enabled ? "media-stop" : "media-start",
      });
      enabled = state.enabled;
      pause.textContent = enabled ? "暂停嗅探" : "继续嗅探";
      globalThis.ZNoteDouyinObserve?.(enabled);if(!enabled){clearTimeout(scanTimer);scanTimer=null;globalThis.ZNoteVideoThumbnailCancel?.()}
      if (enabled) scan();
    });
    controls.append(pause);
    panel.append(controls);
    const destination = element("div", null, { class: "destination" }),
      libraryLabel = element("label", "保存知识库"),
      tagsLabel = element("label", "标签（逗号分隔）");
    selector = element("select", null, { "aria-label": "保存知识库" });
    selector.append(new Option("默认知识库", ""));
    tagInput = element("input", null, {
      "aria-label": "采集标签",
      placeholder: "参考, 灵感",
    });
    libraryLabel.append(selector);
    tagsLabel.append(tagInput);
    destination.append(libraryLabel, tagsLabel);
    const saveDestination = () =>
      send({
        type: "media-destination",
        collection_id: selector.value,
        tags: tagInput.value,
      })
        .then((r) => notify(r.message))
        .catch((e) => notify(e.message));
    selector.addEventListener("change", (e) => {
      if (e.isTrusted) saveDestination();
    });
    tagInput.addEventListener("change", (e) => {
      if (e.isTrusted) saveDestination();
    });
    panel.append(destination);
    list = element("div", null, { class: "list" });
    panel.append(list);
    const footer = element(
      "div",
      "最多保留当前页最近 100 个视频资源。",
      { class: "footer" },
    );
    footer.append(
      button("清空", async () => {
        await send({ type: "media-clear" });
        resources = [];
        draw();
      }),
      button("连接设置", () => send({ type: "media-options" })),
    );
    panel.append(footer);
    status = element("div", null, { class: "status", role: "status" });
    panel.append(status);
    root.append(panel);
    preview = element("div", null, {
      class: "preview hidden",
      "aria-label": "ZNote 高清图片预览",
    });
    previewImage = element("img", null, {
      alt: "高清图片预览",
      referrerpolicy: "no-referrer",
    });
    previewCache=new globalThis.ZNotePreviewCache((url,signal)=>globalThis.ZNoteLoadPreview(url,previewImage.referrerPolicy,signal));
    previewLabel = element("small", shortcutHelp());
    const bar = element("div", null, { class: "bar" });
    bar.style.pointerEvents = 'auto';
    bar.style.fontSize = '13px';
    downloadButton = button('S 下载', () => hoverAction('download'));
    saveButton = button('Z 保存知识库', () => hoverAction('save'));
    originalButton=button('查看原图',()=>turnPage((failedIndex??groupIndex)-requestedIndex,true));originalButton.className='hidden';
    bar.append(downloadButton, saveButton, originalButton, button('关闭', hide));
    bar.querySelectorAll('button').forEach(b=>b.style.padding='5px 7px');
    const sizing = element('label', '展示大小 ', {class:'bar'});
    sizing.style.pointerEvents = 'auto';
    sizeInput = element('input', null, {type:'range',min:'240',max:'1200',step:'40','aria-label':'预览展示大小'});
    sizeInput.value = previewWidth; sizeInput.style.width = '125px';
    sizeInput.addEventListener('input', e => { if (e.isTrusted) { previewWidth = Number(sizeInput.value); placePreview(); } });
    sizeInput.addEventListener('change', e => { if (e.isTrusted) send({type:'media-preview-size',width:Number(sizeInput.value)}).catch(e=>previewLabel.textContent=e.message); });
    sizing.append(sizeInput);
    groupBar = element('div', null, {class:'bar hidden'});
    groupBar.style.pointerEvents='auto';
    previousButton = button('←',()=>turnPage(-1)); previousButton.setAttribute('aria-label','上一张');
    nextButton = button('→',()=>turnPage(1)); nextButton.setAttribute('aria-label','下一张');
    groupCounter = element('span', '', {'aria-label':'作品页码'});
    const openBatch = async(action)=>{
      if(!imageGroup)return; batchButton.disabled=batchSaveButton.disabled=true;
      if((imageGroup.page_url||imageGroup.source_url)!==location.href){hide();batchButton.disabled=batchSaveButton.disabled=false;return;}
      try { const result=await send({type:'media-gallery',group:imageGroup,action});if(result.inline){inlineGallery ||= new globalThis.ZNoteInlineGallery(root);inlineGallery.open(result.id);hide();} }
      catch(e) {previewLabel.textContent=e.message;}
      finally {batchButton.disabled=batchSaveButton.disabled=false;}
    };
    batchButton = button('批量下载',()=>openBatch('download'));
    batchSaveButton = button('批量入库',()=>openBatch('save'));
    groupBar.append(previousButton,groupCounter,nextButton,batchButton,batchSaveButton);
    groupBar.title='鼠标停在原缩略图或展开预览上，向下滚动看下一张，向上滚动看上一张';
    preview.append(previewImage, previewLabel, groupBar, bar, sizing);
    // Capture wheel on either the source thumbnail or our preview. Never hijack
    // scrolling elsewhere on the page, the size slider, or browser zoom gestures.
    document.addEventListener('wheel',e=>{
      if(!e.isTrusted || !imageGroup || imageGroup.images.length<2 || preview.classList.contains('hidden') || e.ctrlKey || e.altKey || e.metaKey || !e.deltaY)return;
      const path=e.composedPath();
      if(path.some(el=>el?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el?.tagName)))return;
      if(!path.includes(preview) && globalThis.ZNoteImageTarget(e)!==hovered)return;
      if((imageGroup.page_url||imageGroup.source_url)!==location.href){hide();return;}
      e.preventDefault();e.stopImmediatePropagation();
      clearTimeout(hideTimer);hideTimer=null;
      if(Date.now()-lastWheel<220)return;lastWheel=Date.now();turnPage(Math.sign(e.deltaY));
    },{passive:false,capture:true});
    window.addEventListener('resize', placePreview);
    window.addEventListener('scroll', () => { if (hovered) hide(); }, {passive:true});
    root.append(preview);
    preview.addEventListener("mouseenter", () => {
      clearTimeout(hideTimer); hideTimer = null;
      clearTimeout(hoverTimer); pendingTarget = null;
    });
    preview.addEventListener("mouseleave", (e) => {
      pointer = { x: e.clientX, y: e.clientY };
      scheduleHide();
    });
    document.addEventListener(
      "mousemove",
      (e) => {
        if (!e.isTrusted) return;
        pointer = { x: e.clientX, y: e.clientY };
        // The companion retains Pixiv's own enhanced preview and wheel controls.
        // Avoid two hover viewers competing when both ZNote extensions are loaded.
        if (location.hostname === 'www.pixiv.net' && document.getElementById('znote-pixiv-entry')) { if (hovered || pendingTarget) hide(); return; }
        if (own(e) || !hoverAllowed) return;
        if (hoverBusy) { if (!sourceUnderPointer()) scheduleHide(); return; }
        const target = globalThis.ZNoteImageTarget(e);
        if (!target) { if (hovered || pendingTarget) scheduleHide(); return; }
        clearTimeout(hideTimer); hideTimer = null;
        if (target === hovered || target === pendingTarget) return;
        clearTimeout(hoverTimer); pendingTarget = target;
        ++hoverToken;
        hoverTimer = setTimeout(
          () => showImage(target, e.clientX, e.clientY),
          350,
        );
      },
      true,
    );
    document.addEventListener(
      "mouseout",
      (e) => {
        if (own(e)) return;
        pointer = { x: e.clientX, y: e.clientY };
        if (hovered || pendingTarget) scheduleHide();
      },
      true,
    );
    document.addEventListener(
      "keydown",
      (e) => {
        if (
          !e.isTrusted ||
          e.repeat ||
          e.isComposing ||
          e.ctrlKey ||
          e.altKey ||
          e.metaKey ||
          e.shiftKey ||
          e
            .composedPath()
            .some(
              (n) =>
                n?.isContentEditable ||
                /^(INPUT|TEXTAREA|SELECT)$/.test(n?.tagName),
            )
        )
          return;
        if (e.key === "Escape") {
          hide();
          closePanel();
          return;
        }
        if (!hoverURL || preview.classList.contains("hidden")) return;
        if(imageGroup && ['ArrowLeft','ArrowRight'].includes(e.key)) {e.preventDefault();e.stopImmediatePropagation();turnPage(e.key==='ArrowRight'?1:-1);return;}
        const key = e.key.toLowerCase();
        if (key === downloadKey || key === saveKey) {
          e.preventDefault();
          e.stopImmediatePropagation();
          hoverAction(key === downloadKey ? "download" : "save");
        }
      },
      true,
    );
    for(const event of ['play','loadstart','loadedmetadata'])document.addEventListener(event,e=>{if(e.target.tagName==='VIDEO'&&enabled)scheduleScan()},true);
    const observer = new MutationObserver(mutations => {
      if(!enabled||siteBlocked||document.hidden)return;
      const selector='video,source,[data-e2e*="author"],[data-e2e*="nickname"]';
      if(mutations.some(m=>m.type==='attributes'?m.target.matches('video,source'):[...m.addedNodes].some(n=>n.nodeType===1&&(n.matches(selector)||n.querySelector(selector)))))scheduleScan();
    });
    observer.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['src','poster']});
    try{new PerformanceObserver(entries=>{let changed=false;for(const entry of entries.getEntries())if(rememberMedia(entry))changed=true;if(changed)scheduleScan()}).observe({type:'resource',buffered:true})}catch{}
    document.addEventListener('visibilitychange',()=>{if(document.hidden){clearTimeout(scanTimer);scanTimer=null;globalThis.ZNoteVideoThumbnailCancel?.();globalThis.ZNoteDouyinObserve?.(false)}else if(enabled){scan();if(!panel.classList.contains('hidden'))poll()}});
    await refreshSettings();
    window.addEventListener('focus', refreshSettings);
    if(!siteBlocked)try{const pending=await send({type:'media-gallery-resume'});if(pending.length){inlineGallery ||= new globalThis.ZNoteInlineGallery(root);for(const job of pending)inlineGallery.open(job.id,{minimized:true});}}catch{}
    window.addEventListener('znote-video-metadata',scheduleScan);
    chrome.runtime.onMessage.addListener((message, sender, reply) => {
      if (sender.id !== chrome.runtime.id) return;
      if (message.type === 'media-settings-changed') { refreshSettings(); reply({ok: true}); }
      if (message.type === "open-media-panel") {
        open().then(()=>reply(siteBlocked?{ok:false,error:'此网站已停用媒体采集，可在扩展设置中管理黑名单'}:{ok:true}),()=>reply({ok:false,error:'无法打开媒体浮窗，请刷新页面重试'}));
        return true;
      }
      if (message.type === "scan-media-frame") {
        if(siteBlocked){reply({ok:false});return;}
        enabled = true;
        scan();
        reply({ ok: true });
      }
    });
  }
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", mount, { once: true });
  else mount();
})();
