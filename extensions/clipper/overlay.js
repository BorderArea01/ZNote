(() => {
  const send = (message) =>
    chrome.runtime.sendMessage(message).then((result) => {
      if (!result?.ok)
        throw new Error(result?.error || "扩展连接已失效，请刷新页面");
      return result.value;
    });
  let host,
    root,
    dock,
    panel,
    preview,
    previewImage,
    previewLabel,
    status,
    list,
    selector,
    tagInput,
    filter = "all",
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
    hoverAllowed = true,
    dockAllowed = true;
  const own = (event) => event.composedPath().includes(host);
  const shortcutHelp = () => `${downloadKey.toUpperCase()} 下载 · ${saveKey.toUpperCase()} 入库`;
  async function refreshSettings() {
    try {
      const config = await send({type: 'media-settings'});
      hoverAllowed = config.hover; dockAllowed = config.dock;
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
  const css = `:host{all:initial;font:13px/1.55 system-ui,'Microsoft YaHei',sans-serif;color:#eaf5f2}*{box-sizing:border-box}button,select,input{font:inherit}button{cursor:pointer;color:inherit;background:#273d39;border:1px solid #51665e;border-radius:9px;padding:7px 11px}button:hover{background:#37554c}button:disabled{opacity:.5;cursor:wait}button:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid #7df2cd}button.primary{background:#217963;border-color:#48af8c}.dock{position:fixed;right:18px;bottom:24px;border:1px solid #84c5af;border-radius:24px;background:#183a31;color:#d9fff1;box-shadow:0 5px 28px #0005;z-index:2147483647;padding:11px 16px;touch-action:none}.panel{position:fixed;right:18px;bottom:80px;width:min(414px,calc(100vw - 24px));max-height:min(710px,calc(100vh - 108px));display:flex;flex-direction:column;background:#152921;color:#eaf5f2;border:1px solid #516b5c;border-radius:16px;box-shadow:0 12px 44px #0007;z-index:2147483647;overflow:hidden}.head,.controls,.destination{padding:12px 14px;border-bottom:1px solid #385348}.head{display:flex;align-items:center;justify-content:space-between;font-weight:650}.head small{font-size:11px;color:#9cb4a8;font-weight:400}.controls{display:flex;gap:6px;flex-wrap:wrap}.controls button[aria-pressed=true]{background:#3c7867}.destination{display:grid;grid-template-columns:1fr 1fr;gap:8px}.destination input,.destination select{width:100%;min-width:0;border:1px solid #51665e;border-radius:7px;background:#233d32;color:inherit;padding:6px}.destination label{font-size:11px}.list{overflow:auto;min-height:70px;padding:9px 12px;overscroll-behavior:contain}.item{padding:11px 0;border-bottom:1px solid #314f42}.row{display:flex;gap:10px;align-items:center}.thumb{width:66px;height:48px;object-fit:cover;border-radius:6px;background:#30483d}.info{min-width:0;flex:1}.title{display:block;white-space:nowrap;text-overflow:ellipsis;overflow:hidden;font-size:12px}.meta{display:block;color:#a6bfb1;font-size:11px;word-break:break-all}.actions{display:flex;gap:7px;margin-top:9px}.footer{padding:10px 14px;color:#a9c2b4;font-size:11px;border-top:1px solid #385348}.status{padding:0 14px 10px;color:#9ae3c3;overflow-wrap:anywhere;font-size:12px}.preview{position:fixed;z-index:2147483646;padding:8px;border:1px solid #8ea99c;border-radius:12px;background:#14271ff5;color:#eaf5f2;box-shadow:0 8px 32px #0007;max-width:calc(100vw - 24px);max-height:calc(100vh - 24px);display:flex;flex-direction:column;gap:7px;pointer-events:auto}.preview img{display:block;max-width:min(720px,calc(100vw - 42px));max-height:calc(100vh - 116px);object-fit:contain}.preview .bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.preview small{font-size:11px;color:#b6d0bf}.empty{color:#a6bfb1;padding:15px 2px}.hidden{display:none!important}`;
  function notify(text) {
    if (status) status.textContent = text;
  }
  async function act(resource, action, btn) {
    if (btn) btn.disabled = true;
    notify("正在处理…");
    try {
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
  function draw() {
    if (!list) return;
    list.replaceChildren();
    const selected = resources.filter(
      (r) =>
        filter === "all" ||
        (filter === "video" ? r.kind !== "image" : r.kind === "image"),
    );
    dock.textContent = `◈ 媒体 ${resources.length || ""}`;
    if (!selected.length)
      list.append(
        element("p", "暂未发现资源。滚动加载图片，或播放视频后再查看。", {
          class: "empty",
        }),
      );
    for (const r of [...selected].reverse()) {
      const item = element("article", null, {
        class: "item",
        "data-resource-id": r.id,
      });
      const row = element("div", null, { class: "row" });
      if (r.kind === "image") {
        const img = element("img", null, {
          class: "thumb",
          alt: "图片",
          loading: "lazy",
          referrerpolicy: "no-referrer",
        });
        img.src = r.url;
        row.append(img);
      } else
        row.append(
          element("span", r.kind === "hls" ? "▶ HLS" : "▶ MP4", {
            class: "thumb",
          }),
        );
      const info = element("div", null, { class: "info" });
      info.append(element("span", r.title, { class: "title", title: r.title }));
      info.append(
        element(
          "span",
          `${r.kind === "image" ? "图片" : r.kind === "hls" ? "m3u8 分段视频" : "视频文件"} · ${new URL(r.url).hostname}${r.bytes && r.kind !== "hls" ? " · " + (r.bytes < 1048576 ? (r.bytes / 1024).toFixed(1) + " KB" : (r.bytes / 1048576).toFixed(1) + " MB") : ""}`,
          { class: "meta" },
        ),
      );
      row.append(info);
      item.append(row);
      const actions = element("div", null, { class: "actions" });
      for (const [text, action] of [
        ["预览", "preview"],
        ["下载", "download"],
        ["保存知识库", "save"],
      ]) {
        const btn = button(text, () => act(r, action, btn));
        actions.append(btn);
      }
      item.append(actions);
      list.append(item);
    }
  }
  function scan() {
    if (!enabled) return;
    const found = [];
    for (const img of document.images) {
      const rect = img.getBoundingClientRect();
      if (rect.width < 24 || rect.height < 24) continue;
      const c = globalThis.ZNoteCandidates(img)[0];
      if (c)
        found.push({
          url: c.url,
          kind: "image",
          title: img.alt || document.title,
          source_url: globalThis.ZNoteSourceLink(img),
        });
    }
    for (const video of document.querySelectorAll("video,source")) {
      const url = video.currentSrc || video.src;
      if (/^https?:/.test(url))
        found.push({ url, mime: "video/mp4", title: document.title });
    }
    for (const el of document.querySelectorAll('[style*="background"]'))
      for (const c of globalThis.ZNoteCandidates(el))
        found.push({ url: c.url, kind: "image", title: document.title });
    for (const r of performance.getEntriesByType("resource"))
      found.push({ url: r.name });
    send({ type: "media-scan", resources: found.slice(-200) })
      .then((state) => {
        resources = state.resources;
        draw();
      })
      .catch((e) => notify(e.message));
  }
  async function open() {
    panel.classList.remove("hidden");
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
    if (panel.classList.contains("hidden")) return;
    try {
      const state = await send({ type: "media-list" });
      if (JSON.stringify(state.resources) !== JSON.stringify(resources)) {
        resources = state.resources;
        draw();
      }
    } catch (e) {
      notify(e.message);
    }
    pollTimer = setTimeout(poll, 1500);
  }
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
    sheet.replaceSync(css + ":host>div,:host>button{pointer-events:auto}");
    root.adoptedStyleSheets = [sheet];
    dock = button("◈ 媒体", () =>
      panel.classList.contains("hidden")
        ? open()
        : panel.classList.add("hidden"),
    );
    dock.className = "dock";
    dock.setAttribute("aria-label", "ZNote 媒体发现");
    root.append(dock);
    panel = element("div", null, {
      class: "panel hidden",
      role: "dialog",
      "aria-label": "ZNote 媒体发现",
    });
    const head = element("div", null, { class: "head" });
    head.append(element("span", "ZNote · 媒体发现"));
    head.append(button("收起", () => panel.classList.add("hidden")));
    panel.append(head);
    const controls = element("div", null, { class: "controls" });
    for (const [text, value] of [
      ["全部", "all"],
      ["图片", "image"],
      ["视频", "video"],
    ]) {
      const btn = button(text, () => {
        filter = value;
        controls
          .querySelectorAll("[aria-pressed]")
          .forEach((b) => b.setAttribute("aria-pressed", "false"));
        btn.setAttribute("aria-pressed", "true");
        draw();
      });
      btn.setAttribute("aria-pressed", String(value === "all"));
      controls.append(btn);
    }
    controls.append(button("扫描", scan));
    const pause = button("暂停嗅探", async () => {
      const state = await send({
        type: enabled ? "media-stop" : "media-start",
      });
      enabled = state.enabled;
      pause.textContent = enabled ? "暂停嗅探" : "继续嗅探";
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
      "最多保留当前页最近 100 个资源；播放视频可发现新资源。",
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
      try { await send({type:'media-gallery',group:imageGroup,action}); }
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
          panel.classList.add("hidden");
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
    const observer = new MutationObserver(() => {
      if (enabled) {
        clearTimeout(observer.timer);
        observer.timer = setTimeout(scan, 800);
      }
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["src", "srcset"],
    });
    try {
      new PerformanceObserver(() => {
        if (enabled) {
          clearTimeout(scan.timer);
          scan.timer = setTimeout(scan, 500);
        }
      }).observe({ type: "resource", buffered: true });
    } catch {}
    await refreshSettings();
    window.addEventListener('focus', refreshSettings);
    chrome.runtime.onMessage.addListener((message, sender, reply) => {
      if (sender.id !== chrome.runtime.id) return;
      if (message.type === 'media-settings-changed') { refreshSettings(); reply({ok: true}); }
      if (message.type === "open-media-panel") {
        open();
        reply({ ok: true });
      }
      if (message.type === "scan-media-frame") {
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
