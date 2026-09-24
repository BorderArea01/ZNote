// Candidate URLs, not pixel manipulation. Keep the source page and author intact.
// XHS CDN structure cross-checked against XHS-Downloader's application/image.py.
const urls = value => typeof value === 'string' ? [value] : Array.isArray(value) ? value.filter(v => typeof v === 'string') : [];
function valid(value, base) {
  try { const u = new URL(value, base); return /^https?:$/.test(u.protocol) && !u.username && !u.password ? u.href : ''; } catch { return ''; }
}
export function captureImageCandidates(image, platform, base) {
  let candidates = [];
  if (platform === 'xhs') {
    const info = Array.isArray(image.infoList) ? image.infoList : [];
    const original = [...urls(image.urlOriginal), ...urls(image.urlOrigin), ...info.filter(v => /^(?:ORIGINAL|WB_ORIGINAL)$/.test(v.imageScene)).flatMap(v => urls(v.url))];
    const display = [...info.filter(v => v.imageScene === 'WB_DFT').flatMap(v => urls(v.url)), ...urls(image.urlDefault), ...urls(image.url)];
    const derivedClean = [], derivedAuto = [];
    for (const value of [...original, ...display]) {
      try {
        const u = new URL(value, base), segments = u.pathname.split('/').filter(Boolean);
        // Derive fixed-format images only from the two known XHS CDN layouts.
        // The webpic URL is a signed display variant that can contain a mark;
        // its token points to the full-resolution, clean image.
        const webpic = /^sns-webpic(?:-[a-z]+)?\.xhscdn\.com$/.test(u.hostname) && segments.length >= 3;
        const auto = u.hostname === 'sns-img-bd.xhscdn.com' && segments.length >= 1;
        if (!webpic && !auto) continue;
        const token = (webpic ? segments.slice(2) : segments).join('/').split('!')[0];
        if (!/^[a-zA-Z0-9_/-]+$/.test(token)) continue;
        derivedClean.push(`https://ci.xiaohongshu.com/${token}?imageView2/format/webp`);
        derivedAuto.push('https://sns-img-bd.xhscdn.com/' + token);
      } catch {}
    }
    candidates = [...original, ...derivedClean, ...derivedAuto, ...display];
  } else {
    // Playback/display URLs precede the download variants, which can carry platform marks.
    candidates = [
      ...urls(image.origin_url), ...urls(image.originUrl),
      ...urls(image.original_url), ...urls(image.originalUrl),
      ...urls(image.url_list), ...urls(image.urlList),
      ...urls(image.display_image?.url_list), ...urls(image.displayImage?.urlList),
      ...urls(image.url),
      ...urls(image.download_url_list), ...urls(image.downloadUrlList),
    ];
  }
  return [...new Set(candidates.map(v => valid(v, base)).filter(Boolean))].slice(0, 5);
}
