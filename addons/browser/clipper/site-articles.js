const isBilibiliHost = host => /(?:^|\.)bilibili\.com$|(?:^|\.)b23\.tv$/i.test(host);
const isBilibiliImage = value => {
  try {
    const url = new URL(String(value || '').replace(/^\/\//, 'https://').replace(/^http:/i, 'https:'));
    return url.protocol === 'https:' && /(?:^|\.)hdslb\.com$|(?:^|\.)bilivideo\.com$|(?:^|\.)bilibili\.com$/i.test(url.hostname) && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
};

// Bilibili's opus page embeds a JSON SSR state instead of a normal article
// element. Read only the assigned JSON; the extension never executes page
// scripts or trusts arbitrary script text as markup.
function bilibiliScriptJson(raw) {
  const match = String(raw || '').match(/(?:window|self|globalThis)\.__INITIAL_STATE__\s*=\s*/);
  if (!match) return null;
  let value = String(raw).slice(match.index + match[0].length), depth = 0, quoted = false, escaped = false, end = 0;
  for (let index = 0; index < value.length; index++) {
    const char = value[index];
    if (quoted) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') quoted = false; continue; }
    if (char === '"') { quoted = true; continue; }
    if (char === '{' || char === '[') depth++;
    else if (char === '}' || char === ']') { depth--; if (depth === 0) { end = index + 1; break; } }
  }
  if (!end || end > 8 * 1024 * 1024) return null;
  try { return JSON.parse(value.slice(0, end)); } catch { return null; }
}
function bilibiliDetail(document) {
  for (const script of [...document.querySelectorAll('script:not([src])')].slice(0, 150)) {
    const data = bilibiliScriptJson(script.textContent);
    const detail = data?.opus?.detail || data?.opus?.data?.detail;
    if (detail && Array.isArray(detail.modules)) return { data, detail };
  }
  return null;
}
function bilibiliNodesText(nodes) {
  if (!Array.isArray(nodes)) return '';
  return nodes.map(node => {
    if (node?.word?.words != null) return String(node.word.words);
    if (node?.rich) return String(node.rich.orig_text || node.rich.text || node.rich.emoji?.text || '');
    if (node?.user) return String(node.user.name || node.user.nickname || node.user.uname || '');
    if (node?.formula) return String(node.formula.text || node.formula.content || '');
    return '';
  }).join('');
}
function bilibiliCleanText(value) { return String(value || '').replace(/\r\n?/g, '\n').trim(); }
function bilibiliAppendParagraph(doc, parent, paragraph, images, tags) {
  if (!paragraph || typeof paragraph !== 'object') return;
  const text = bilibiliCleanText(bilibiliNodesText(paragraph.text?.nodes));
  if (text) {
    const p = doc.createElement('p');
    for (const node of paragraph.text?.nodes || []) {
      const value = bilibiliNodesText([node]); if (!value) continue;
      const rich = node.rich;
      if (rich?.type === 'RICH_TEXT_NODE_TYPE_TOPIC') tags.push(value.replace(/^#|#$/g, '').trim());
      if (rich?.jump_url) {
        const link = doc.createElement('a');
        try { const href = new URL(rich.jump_url.replace(/^\/\//, 'https://'), 'https://www.bilibili.com').href; if (/^https?:$/.test(new URL(href).protocol)) link.href = href; } catch {}
        link.textContent = value; p.append(link);
      } else p.append(doc.createTextNode(value));
    }
    if (!p.textContent) p.textContent = text;
    parent.append(p);
  }
  const heading = bilibiliCleanText(bilibiliNodesText(paragraph.heading?.nodes));
  if (heading) { const h = doc.createElement(`h${Math.min(6, Math.max(1, Number(paragraph.heading?.level) || 3))}`); h.textContent = heading; parent.append(h); }
  const quote = bilibiliCleanText(bilibiliNodesText(paragraph.blockquote?.nodes));
  if (quote) { const blockquote = doc.createElement('blockquote'); blockquote.textContent = quote; parent.append(blockquote); }
  const code = bilibiliCleanText(paragraph.code?.content || paragraph.code?.text || bilibiliNodesText(paragraph.code?.nodes));
  if (code) { const pre = doc.createElement('pre'); pre.textContent = code; parent.append(pre); }
  for (const pic of paragraph.pic?.pics || []) {
    const src = isBilibiliImage(pic?.url || pic?.url_default || pic?.urlDefault); if (!src || images.has(src)) continue;
    images.add(src); const img = doc.createElement('img'); img.src = src; img.alt = `配图 ${images.size}`; img.setAttribute('data-znote-work-image', ''); parent.append(img);
  }
  const list = paragraph.list, children = Array.isArray(list?.children) ? list.children : [];
  if (children.length) {
    const listNode = doc.createElement(Number(list.style) === 1 ? 'ol' : 'ul');
    for (const child of children) { const item = doc.createElement('li'); for (const nested of child?.children || []) bilibiliAppendParagraph(doc, item, nested, images, tags); if (item.textContent || item.querySelector('img')) listNode.append(item); }
    if (listNode.childElementCount) parent.append(listNode);
  }
}
function bilibiliArticle(document, detail) {
  const titleModule = detail.modules.find(module => module?.module_type === 'MODULE_TYPE_TITLE');
  const authorModule = detail.modules.find(module => module?.module_type === 'MODULE_TYPE_AUTHOR')?.module_author || {};
  const title = String(titleModule?.module_title?.text || detail.basic?.title || document.title || 'B站图文笔记').replace(/\s+-\s*哔哩哔哩\s*$/i, '');
  const author = String(authorModule.name || authorModule.uname || authorModule.nickname || '');
  const clone = document.implementation.createHTMLDocument(title), article = clone.createElement('article');
  const heading = clone.createElement('h1'); heading.textContent = title; article.append(heading);
  if (author) { const byline = clone.createElement('p'); byline.textContent = `作者：${author}`; article.append(byline); }
  const images = new Set(), tags = [];
  for (const module of detail.modules) for (const paragraph of module?.module_content?.paragraphs || []) bilibiliAppendParagraph(clone, article, paragraph, images, tags);
  if (!article.textContent.trim() && !images.size) return null;
  clone.body.append(article);
  return { document: clone, title, byline: author, selector: 'article', tags: [...new Set(tags)].filter(Boolean) };
}
async function bilibiliFetchedArticle(document, location, fetcher) {
  // Bilibili hydrates the opus page and may remove the SSR script from the
  // live DOM before the extension's article window asks for it. Re-read the
  // same page with the user's existing session, then parse the response in an
  // inert document. This keeps the extractor independent of page globals and
  // does not execute fetched scripts.
  try {
    const response = await fetcher(location.href, { credentials: 'include', redirect: 'follow', signal: AbortSignal.timeout(15000) });
    if (!response?.ok) return null;
    const html = await response.text();
    if (html.length > 8 * 1024 * 1024) return null;
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    const state = bilibiliDetail(parsed);
    return state ? bilibiliArticle(parsed, state.detail) : null;
  } catch { return null; }
}

// Site adapters read only the selected work, never creator-wide recommendations.
export async function siteArticle(document, location, fetcher = fetch) {
  const host=location.hostname.replace(/^www\./,'');
  if (isBilibiliHost(host)) {
    const state = bilibiliDetail(document);
    const rendered = state && bilibiliArticle(document, state.detail) || await bilibiliFetchedArticle(document, location, fetcher);
    if (rendered) return rendered;
    const source = document.querySelector('.opus-modules,.opus-detail,[class*="opus-detail"]');
    if (source && /\/opus\//i.test(location.pathname)) {
      const clone = document.implementation.createHTMLDocument(document.title), article = source.cloneNode(true);
      article.querySelectorAll('nav,header,footer,button,[role="button"],[data-znote-overlay]').forEach(el => el.remove());
      clone.body.append(article);
      if (article.textContent.trim() || article.querySelector('img')) return { document: clone, title: document.title.replace(/\s+-\s*哔哩哔哩\s*$/i, ''), selector: 'article' };
    }
    throw Error('B站图文正文尚未加载，请打开完整作品后重试');
  }
  if(host==='pixiv.net') {
    const id=location.pathname.match(/^\/(?:[a-z]{2}\/)?artworks\/(\d+)\/?$/)?.[1];
    if(!id) throw Error('请打开 Pixiv 单个作品详情页后采集正文');
    async function json(path){
      const response=await fetcher(new URL(path,location.origin),{credentials:'include',redirect:'error',signal:AbortSignal.timeout(15000)});
      if(!response.ok)throw Error(`Pixiv 作品读取失败 HTTP ${response.status}，请确认已登录并能打开该作品`);
      const text=await response.text();if(text.length>5*1024*1024)throw Error('Pixiv 作品数据过大');
      let data;try{data=JSON.parse(text);}catch{throw Error('Pixiv 返回了验证页面，请先在原网页完成验证');}
      if(data.error || !data.body)throw Error(data.message||'Pixiv 作品不可访问');return data.body;
    }
    const [info,pages]=await Promise.all([json(`/ajax/illust/${id}`),json(`/ajax/illust/${id}/pages`)]);
    if(!Array.isArray(pages)||!pages.length||pages.length>200)throw Error('该作品页数超出本次支持范围（1～200 张）');
    if(Number(info.pageCount)>pages.length)throw Error('Pixiv 未返回全部作品页，请稍后重试');
    const clone=document.implementation.createHTMLDocument(info.title||document.title), article=clone.createElement('article');
    const heading=clone.createElement('h1');heading.textContent=info.title||document.title;article.append(heading);
    const author=clone.createElement('p');author.textContent=`作者：${info.userName||info.userId||'未知'}`;article.append(author);
    const description=clone.createElement('div');description.innerHTML=info.description||'';article.append(description);
    if(info.illustType===2){const note=clone.createElement('p');note.textContent='此作品为动图，本笔记归档的是静态预览图，不包含动画帧。';article.append(note);}
    for(const [index,page] of pages.entries()) {
      const url=new URL(page.urls?.original||'');
      if(url.protocol!=='https:'||!/(^|\.)pximg\.net$/.test(url.hostname))throw Error('Pixiv 原图地址无法识别');
      const img=clone.createElement('img');img.src=url.href;img.alt=`第 ${index+1} 张`;img.setAttribute('data-znote-work-image','');
      try {const preview=new URL(page.urls.regular||page.urls.small||url.href);if(preview.protocol==='https:'&&/(^|\.)pximg\.net$/.test(preview.hostname)&&!preview.username&&!preview.password)img.setAttribute('data-znote-preview',preview.href);}catch{}
      article.append(img);
    }
    clone.body.append(article);return {document:clone,title:info.title,byline:info.userName||'',selector:'article'};
  }
  if(['pawchive.pw','pawchive.st'].includes(host)) {
    if(!/^\/(?:fanbox|patreon)\/user\/[^/]+\/post\/[^/]+\/?$/.test(location.pathname))throw Error('请打开 Pawchive 单篇作品页后采集正文');
    const main=document.querySelector('main');if(!main)throw Error('Pawchive 正文尚未加载，请先打开作品');
    // PawPreviewer uses main figure links / fileThumb anchors for original files.
    const clone=document.implementation.createHTMLDocument(document.title), article=main.cloneNode(true);
    article.querySelectorAll('nav,aside,.post-card--preview,.post__comments,.post__recommendations,[data-znote-overlay]').forEach(el=>el.remove());
    const isOriginal=value=>{
      try{const url=new URL(value,location.href);return /^https?:$/.test(url.protocol)&&/^file\.pawchive\.(pw|st)$/.test(url.hostname)&&/\.(avif|bmp|gif|jpe?g|png|webp)$/i.test(url.searchParams.get('f')||url.pathname);}catch{return false;}
    };
    const seen=new Set();
    for(const link of article.querySelectorAll('figure a[href],a.fileThumb[href]')){
      const url=new URL(link.getAttribute('href'),location.href).href;if(!isOriginal(url))continue;
      if(seen.has(url)){link.remove();continue;} seen.add(url);
      const img=clone.createElement('img');img.src=url;img.alt=link.querySelector('img')?.alt||`作品配图 ${seen.size}`;img.setAttribute('data-znote-work-image','');
      const source=link.querySelector('img');
      try {const preview=new URL(source?.getAttribute('data-src')||source?.getAttribute('src')||url,location.href);if(/^https?:$/.test(preview.protocol)&&/^(?:img|file)\.pawchive\.(pw|st)$/.test(preview.hostname)&&!preview.username&&!preview.password)img.setAttribute('data-znote-preview',preview.href);}catch{}
      link.replaceWith(img);
    }
    for(const image of article.querySelectorAll('img')) if(!seen.has(image.getAttribute('src'))&&!image.closest('.post__content'))image.remove();
    if(!seen.size && !article.querySelector('.post__content'))throw Error('未找到作品正文或原图，请确认已登录且作品加载完成');
    clone.body.append(article);return {document:clone,title:main.querySelector('h1')?.textContent?.trim()||document.title,selector:'main'};
  }
  return null;
}
