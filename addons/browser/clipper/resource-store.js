export function isInitializationSegment(url) {
  let pathname;
  try { pathname = new URL(url).pathname; } catch { return false; }
  return /(?:^|\/)init(?:ialization)?(?:[-_][^/]*)?\.mp4$/i.test(pathname) ||
    /(?:^|\/)seg-[^/]*-init\.mp4$/i.test(pathname) ||
    /(?:^|\/)init-stream(?:[-_][^/]*)?\.mp4$/i.test(pathname);
}

export function mediaKind(url, mime = "") {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (
    !/^https?:$/.test(u.protocol) ||
    u.username ||
    u.password ||
    u.href.length > 4096
  )
    return null;
  if (isInitializationSegment(url)) return null;
  if (/mpegurl/i.test(mime) || /\.m3u8(?:$|[?#])/i.test(url)) return "hls";
  if (/\.(m4s|ts|aac)(?:$|[?#])/i.test(url) || /video\/mp2t/i.test(mime))
    return null;
  if (
    /^image\//i.test(mime) ||
    /\.(jpe?g|png|webp|gif|avif)(?:$|[?#!@])/i.test(url)
  )
    return "image";
  if (
    /^video\/(mp4|webm|quicktime)/i.test(mime) ||
    /\.(mp4|webm|mov)(?:$|[?#])/i.test(url)
  )
    return "video";
  return null;
}
export function addResource(state, value, allowImages=false) {
  const kind =
    mediaKind(value.url, value.mime) ||
    (value.kind === "image" && mediaKind(value.url, "image/unknown")) ||
    (value.kind === "video" && mediaKind(value.url, "video/mp4"));
  if (!kind || (kind==='image'&&!allowImages)) return null;
  const url = new URL(value.url);
  url.hash = "";
  let source = state.source_url;
  try {
    const detail = new URL(value.source_url), page = new URL(state.source_url);
    if (/^https?:$/.test(detail.protocol) && detail.origin === page.origin && !detail.username && !detail.password && detail.href.length <= 4096) source = detail.href;
  } catch {}
  let resource = state.resources.find((r) => r.url === url.href);
  const rank=Math.max(0,Math.min(3,Number(value.metadata_rank)||0));
  let poster='';try{const p=new URL(value.poster);if(/^https?:$/.test(p.protocol)&&!p.username&&!p.password&&p.href.length<4096)poster=p.href}catch{}
  const metadata={title:String(value.title||'').slice(0,200),author:String(value.author||'').slice(0,200),author_url:String(value.author_url||'').slice(0,4096),poster,work_id:/^\d{1,30}$/.test(value.work_id||'')?value.work_id:''};
  if (resource) {
    if(rank>=(resource.metadata_rank||0)){
      if(value.source_url)resource.source_url=source;
      for(const field of ['title','author','author_url','poster','work_id'])if(metadata[field])resource[field]=metadata[field];
      resource.metadata_rank=rank;
    }
    if (value.bytes) resource.bytes = value.bytes;
    if (value.total_bytes) resource.total_bytes = Math.max(Number(resource.total_bytes) || 0, Number(value.total_bytes) || 0) || null;
    if (value.partial !== undefined) resource.partial = Boolean(value.partial);
    if (value.mime) {
      resource.mime = value.mime.slice(0, 100);
      resource.kind = kind;
    }
    return resource;
  }
  resource = {
    id: crypto.randomUUID(),
    url: url.href,
    kind,
    mime: (value.mime || "").slice(0, 100),
    bytes: Number(value.bytes) || null,
    total_bytes: Number(value.total_bytes) || null,
    partial: Boolean(value.partial),
    title: String(
      value.title || url.pathname.split("/").pop() || "网页资源",
    ).slice(0, 180),
    source_url: source,
    author:metadata.author,author_url:metadata.author_url,poster:metadata.poster,work_id:metadata.work_id,metadata_rank:rank,
    found_at: Date.now(),
  };
  state.resources.push(resource);
  if (state.resources.length > 100) state.resources.shift();
  return resource;
}
