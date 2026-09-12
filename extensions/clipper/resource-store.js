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
export function addResource(state, value) {
  const kind =
    mediaKind(value.url, value.mime) ||
    (value.kind === "image" && mediaKind(value.url, "image/unknown")) ||
    (value.kind === "video" && mediaKind(value.url, "video/mp4"));
  if (!kind) return null;
  const url = new URL(value.url);
  url.hash = "";
  let source = state.source_url;
  try {
    const detail = new URL(value.source_url), page = new URL(state.source_url);
    if (/^https?:$/.test(detail.protocol) && detail.origin === page.origin && !detail.username && !detail.password && detail.href.length <= 4096) source = detail.href;
  } catch {}
  let resource = state.resources.find((r) => r.url === url.href);
  if (resource) {
    if (value.source_url) resource.source_url = source;
    if (value.bytes) resource.bytes = value.bytes;
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
    title: String(
      value.title || url.pathname.split("/").pop() || "网页资源",
    ).slice(0, 180),
    source_url: source,
    found_at: Date.now(),
  };
  state.resources.push(resource);
  if (state.resources.length > 100) state.resources.shift();
  return resource;
}
