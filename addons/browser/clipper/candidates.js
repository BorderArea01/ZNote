// Shared by hover preview, DOM discovery and the existing right-click collector.
globalThis.ZNoteCandidates = (element) => {
  const candidates = [];
  const add = (value, score = 0) => {
    if (typeof value !== 'string' || !value.trim()) return;
    try {
      const u = new URL(value, document.baseURI);
      if (/^https?:$/.test(u.protocol) && !u.username && !u.password) {
        candidates.push({ url: u.href, score });
        // Known XHS cover preset -> detail preset. Keep the signed path/query,
        // and always retain the displayed URL as a fallback.
        if (/^sns-webpic(?:-[a-z]+)?\.xhscdn\.com$/.test(u.hostname) && /!nc_[^/]+$/.test(u.pathname)) {
          u.pathname = u.pathname.replace(/!nc_[^/]+$/, '!nd_dft_wlteh_webp_3');
          candidates.push({url: u.href, score: score + 1e10});
        }
      }
    } catch {}
  };
  const img = element?.tagName === "IMG" ? element : null;
  if (img) {
    try {
      const u = new URL(img.currentSrc || img.src);
      if (u.hostname === "pbs.twimg.com" && u.pathname.startsWith("/media/")) {
        u.searchParams.set("name", "orig");
        add(u.href, 2e12);
      }
      if (/(^|\.)hdslb\.com$/.test(u.hostname) && u.pathname.includes("@")) {
        u.pathname = u.pathname.split("@")[0];
        add(u.href, 2e12);
      }
    } catch {}
    for (const name of [
      "data-original",
      "data-full",
      "data-fullsize",
      "data-large",
      "data-src-original",
      "data-zoom-image",
      "data-original-src",
      "data-lazy-src",
    ])
      if (img.getAttribute(name)) add(img.getAttribute(name), 1e12);
    const anchor = img.closest("a[href]");
    if (anchor && /\.(jpe?g|png|webp|gif|avif)(?:[?#]|$)/i.test(anchor.href))
      add(anchor.href, 1e11);
    for (const srcset of [
      img.srcset,
      img.getAttribute("data-srcset"),
      ...[...(img.closest("picture")?.querySelectorAll("source") || [])]
        .filter((s) => !s.media || matchMedia(s.media).matches)
        .map((s) => s.srcset),
    ].filter(Boolean)) {
      for (const part of srcset.split(/,\s*/)) {
        const m = part.trim().match(/^(\S+)\s+(\d+(?:\.\d+)?)(w|x)$/);
        if (m)
          add(
            m[1],
            Number(m[2]) *
              (m[3] === "x" ? img.width || img.naturalWidth || 1 : 1),
          );
      }
    }
    if (img.dataset.src) add(img.dataset.src, 1);
    let wrapper = img.parentElement;
    for (let depth = 0; wrapper && depth < 2 && !['BODY', 'HTML'].includes(wrapper.tagName); depth++, wrapper = wrapper.parentElement) {
      if (wrapper.querySelectorAll('img').length !== 1) break;
      for (const name of ['data-original', 'data-full', 'data-large', 'data-zoom-image']) add(wrapper.getAttribute(name), 1e12);
    }
    add(img.currentSrc || img.src, 0);
    add(img.src, -1);
  } else if (element) {
    for (const name of ['data-original', 'data-full', 'data-large', 'data-zoom-image', 'data-src']) {
      if (element.getAttribute(name)) add(element.getAttribute(name), 1e12);
    }
    const bg = getComputedStyle(element).backgroundImage;
    for (const m of bg.matchAll(/url\(["']?([^"')]+)["']?\)/g)) add(m[1]);
    if (
      element.tagName === "A" &&
      /\.(jpe?g|png|webp|gif|avif)(?:[?#]|$)/i.test(element.href)
    )
      add(element.href);
  }
  const seen = new Set();
  return candidates
    .sort((a, b) => b.score - a.score)
    .filter((c) => !seen.has(c.url) && seen.add(c.url))
    .slice(0, 12);
};

// Resolve the visible thumbnail even when a link, badge or pointer-events:none
// image prevents the IMG itself from becoming the event target. Stay within a
// small local wrapper; never pick the first unrelated image in a gallery.
globalThis.ZNoteImageTarget = (event) => {
  const path = event.composedPath();
  const direct = path.find(n => n?.tagName === 'IMG');
  if (direct && globalThis.ZNoteCandidates(direct).length) return direct;
  const visibleAtPoint = el => {
    const r = el.getBoundingClientRect(), style = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && event.clientX >= r.left && event.clientX <= r.right && event.clientY >= r.top && event.clientY <= r.bottom && style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0';
  };
  let target = path.find(n => n instanceof Element);
  for (let level = 0; target && level < 4 && !['BODY', 'HTML'].includes(target.tagName); level++, target = target.parentElement) {
    const images = [...target.querySelectorAll('img')].slice(0, 80).filter(visibleAtPoint);
    const image = images.find(img => globalThis.ZNoteCandidates(img).length);
    if (image) return image;
    if (visibleAtPoint(target) && globalThis.ZNoteCandidates(target).length) return target;
  }
  return null;
};

globalThis.ZNoteSourceLink = (target) => {
  // Prefer the enclosing post/detail link, never an image CDN URL or profile/avatar link.
  let node = target;
  for (let level = 0; node && level < 4 && !['BODY', 'HTML'].includes(node.tagName); level++, node = node.parentElement) {
    const links = node.matches?.('a[href]') ? [node] : [...node.querySelectorAll('a[href]')].slice(0, 20);
    for (const link of links) {
      try {
        const url = new URL(link.href);
        if (url.origin !== location.origin || url.username || url.password) continue;
        if (/\/(?:explore|discovery\/item|video|read|status)\//.test(url.pathname)) return url.href;
      } catch {}
    }
  }
  return location.href;
};
