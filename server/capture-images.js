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
    const derived = [];
    for (const value of display) {
      try {
        const u = new URL(value, base), segments = u.pathname.split('/').filter(Boolean);
        // Only the known web-picture CDN has the /expiry/signature/image-token layout.
        // Do not strip signatures or transforms from arbitrary sites.
        if (/^sns-webpic(?:-[a-z]+)?\.xhscdn\.com$/.test(u.hostname) && segments.length >= 3) {
          const token = segments.slice(2).join('/').split('!')[0];
          if (/^[a-zA-Z0-9_/-]+$/.test(token)) derived.push('https://sns-img-bd.xhscdn.com/' + token);
        }
      } catch {}
    }
    candidates = [...original, ...derived, ...display];
  } else {
    // Playback/display URLs precede the download variants, which can carry platform marks.
    candidates = [...urls(image.origin_url), ...urls(image.original_url), ...urls(image.url_list), ...urls(image.display_image?.url_list), ...urls(image.url), ...urls(image.download_url_list)];
  }
  return [...new Set(candidates.map(v => valid(v, base)).filter(Boolean))].slice(0, 5);
}
