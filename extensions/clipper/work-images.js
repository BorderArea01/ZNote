import { siteArticle } from './site-articles.js';

let cached;
export async function workImages(target, doc = document, loc = location) {
  const host = loc.hostname.replace(/^www\./, ''), source_url = loc.href;
  let title = doc.title, images;
  if (host === 'pixiv.net' || /^pawchive\.(pw|st)$/.test(host)) {
    if (host === 'pixiv.net') {
      const id = loc.pathname.match(/\/artworks\/(\d+)/)?.[1];
      const urls = globalThis.ZNoteCandidates(target).map(c => c.url);
      if (!id || !urls.some(url => url.includes('/' + id + '_p'))) return null;
    } else if (!target.closest('main') || target.closest('.post-card--preview,.post__comments,.post__recommendations,header,aside,nav')) return null;
    if (!cached || cached.url !== source_url || Date.now() - cached.time > 60000) {
      cached = {url:source_url,time:Date.now(),promise:siteArticle(doc,loc)};
      cached.promise.catch(() => { if (cached?.url === source_url) cached = null; });
    }
    const article = await cached.promise;
    title = article.title || title;
    images = [...article.document.querySelectorAll('[data-znote-work-image]')].map(img => img.src);
  } else {
    // Only an explicit article/gallery containing the hovered image, never a whole feed.
    const container = target.closest('article,[data-gallery],.post__content');
    if (!container) return null;
    images = [...container.querySelectorAll('img')].filter(img => !img.closest('nav,aside,header,footer,[data-znote-overlay]') && Math.max(img.naturalWidth,img.width) >= 120 && Math.max(img.naturalHeight,img.height) >= 120)
      .map(img => globalThis.ZNoteCandidates(img)[0]?.url).filter(Boolean);
  }
  images = [...new Set(images)].filter(value => { try { const u=new URL(value);return /^https?:$/.test(u.protocol)&&!u.username&&!u.password&&value.length<=4096; } catch { return false; } });
  if (images.length > 200) throw Error('当前作品超过 200 张，请分段采集');
  return images.length > 1 ? {title:title.slice(0,180),source_url,images} : null;
}
