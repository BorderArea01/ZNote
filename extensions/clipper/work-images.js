import { siteArticle } from './site-articles.js';
const cache = new Map();
const safeURL = value => {try{const u=new URL(value);return /^https?:$/.test(u.protocol)&&!u.username&&!u.password&&u.href.length<=4096?u.href:null;}catch{return null;}};
function workLink(target, loc, pattern) {
  for(let node=target,depth=0;node&&depth<4&&!['BODY','HTML','MAIN'].includes(node.tagName);node=node.parentElement,depth++) {
    if(!node.matches?.('a[href]')&&node.querySelectorAll('img').length>1)break;
    const links=node.matches?.('a[href]')?[node]:[...node.querySelectorAll('a[href]')].slice(0,12);
    for(const link of links){try{const url=new URL(link.getAttribute('href'),loc.href);if(url.origin===loc.origin&&pattern.test(url.pathname)&&!url.username&&!url.password)return url;}catch{}}
  }
  return null;
}
export function workLocation(target, loc = location) {
  const host=loc.hostname.replace(/^www\./,''),candidates=globalThis.ZNoteCandidates(target);
  if(host==='pixiv.net') {
    if(candidates.some(c=>/\/user-profile\//.test(c.url)))return null;
    const pattern=/^\/(?:[a-z]{2}\/)?artworks\/\d+\/?$/;
    const link=workLink(target,loc,pattern);
    const imageId=candidates.map(c=>{try{const u=new URL(c.url);return /(^|\.)pximg\.net$/.test(u.hostname)?u.pathname.match(/\/(\d+)_p\d+/)?.[1]:null;}catch{return null;}}).find(Boolean);
    if(link){const id=link.pathname.match(/artworks\/(\d+)/)[1];if(imageId&&id!==imageId)return null;return link;}
    if(imageId)return new URL('/artworks/'+imageId,loc.origin);
  }
  if(/^pawchive\.(pw|st)$/.test(host)) {
    if(!candidates.some(c=>/^https?:\/\/(?:img|file)\.pawchive\.(pw|st)\//.test(c.url)))return null;
    const pattern=/^\/(?:fanbox|patreon)\/user\/[^/]+\/post\/[^/]+\/?$/;
    const link=workLink(target,loc,pattern);if(link)return link;
    if(pattern.test(loc.pathname)&&target.closest('main')&&!target.closest('.post-card--preview,.post__comments,.post__recommendations,header,aside,nav'))return new URL(loc.href);
  }
  return null;
}
export async function workImages(target, doc = document, loc = location) {
  loc=new URL(loc.href); // Freeze this request's route while an SPA navigation is in flight.
  const host=loc.hostname.replace(/^www\./,''),page_url=loc.href,selected=workLocation(target,loc);
  let source_url=page_url,title=doc.title,images,previews;
  if(host==='pixiv.net'||/^pawchive\.(pw|st)$/.test(host)) {
    if(!selected)return null;source_url=selected.href;
    const live=host!=='pixiv.net'&&selected.pathname===loc.pathname;
    let cached=live?null:cache.get(source_url);
    if(!cached||Date.now()-cached.time>60000) {
      const promise=(async()=>{
        let root=doc;
        if(host!=='pixiv.net'&&selected.pathname!==loc.pathname){
          const response=await fetch(selected,{credentials:'include',redirect:'error',signal:AbortSignal.timeout(12000)});
          if(!response.ok)throw Error(`作品读取失败 HTTP ${response.status}`);
          const html=await response.text();if(html.length>5*1024*1024)throw Error('作品页面过大');
          root=new DOMParser().parseFromString(html,'text/html');
        }
        const article=await siteArticle(root,selected);
        // Anonymous Paw pages can contain only thumbnails. Never silently treat
        // those as originals, and do not cache this state across login/retry.
        if(/^pawchive\./.test(host)&&!article.document.querySelector('[data-znote-work-image]'))throw Error('未找到套图原图链接，请确认 Paw 已登录且作品已加载完成');
        return article;
      })();
      cached={time:Date.now(),promise};if(!live){cache.delete(source_url);cache.set(source_url,cached);}
      while(cache.size>8)cache.delete(cache.keys().next().value);
      promise.catch(()=>{if(cache.get(source_url)===cached)cache.delete(source_url);});
    }
    const article=await cached.promise;
    title=article.title||title;
    const nodes=[...article.document.querySelectorAll('[data-znote-work-image]')];
    images=nodes.map(img=>img.src);previews=nodes.map(img=>img.getAttribute('data-znote-preview')||img.src);
  } else {
    const container=target.closest('article,[data-gallery],.post__content');if(!container)return null;
    const nodes=[...container.querySelectorAll('img')].filter(img=>!img.closest('nav,aside,header,footer,[data-znote-overlay]')&&Math.max(img.naturalWidth,img.width)>=32&&Math.max(img.naturalHeight,img.height)>=32&&
      ((Math.max(img.naturalWidth,img.width)>=120&&Math.max(img.naturalHeight,img.height)>=120)||img.matches('[data-original],[data-full],[data-preview]')||/\.(png|jpe?g|webp|gif|avif)(?:[?#]|$)/i.test(img.closest('a[href]')?.href||'')));
    images=nodes.map(img=>globalThis.ZNoteCandidates(img)[0]?.url);
    previews=nodes.map((img,i)=>img.getAttribute('data-preview')||images[i]);
  }
  const pairs=[];const seen=new Set();
  images.forEach((value,i)=>{const url=safeURL(value);if(url&&!seen.has(url)){seen.add(url);pairs.push({original:url,preview:safeURL(previews[i])||url});}});
  if(pairs.length>200)throw Error('当前作品超过 200 张，请分段采集');
  if(!pairs.length||(!selected&&pairs.length<2))return null;
  const candidates=globalThis.ZNoteCandidates(target).map(c=>c.url);
  const identity=url=>{try{const u=new URL(url);if(selected&&host==='pixiv.net')return u.pathname.match(/\/(\d+_p\d+)/)?.[1]||url;if(selected&&/^pawchive\./.test(host))return u.pathname.replace(/^\/thumbnail/,'');return url;}catch{return url;}};
  const index=pairs.findIndex(p=>candidates.some(url=>url===p.original||url===p.preview||identity(url)===identity(p.original)||identity(url)===identity(p.preview)));
  if(index<0&&!selected)return null;
  return {title:title.slice(0,180),source_url,page_url,images:pairs.map(p=>p.original),previews:pairs.map(p=>p.preview),start_index:Math.max(0,index)};
}
