export const MAX_BYTES = 500 * 1024 * 1024;
export function httpUrl(value, base) {
  const u = new URL(value, base);
  if (!/^https?:$/.test(u.protocol) || u.username || u.password)
    throw new Error("播放列表包含不支持的资源地址");
  return u.href;
}
function attributes(line) {
  return Object.fromEntries(
    [
      ...line
        .slice(line.indexOf(":") + 1)
        .matchAll(/([A-Z0-9-]+)=("[^"]*"|[^,]*)/g),
    ].map((m) => [m[1], m[2].replace(/^"|"$/g, "")]),
  );
}
export async function packageHls(
  url,
  { signal, onProgress = () => {}, quality = -1 } = {},
) {
  const files = new Map(),
    downloads = new Map();
  let bytes = 0,
    count = 0;
  async function get(url, max) {
    const response = await fetch(httpUrl(url), {
      credentials: "include",
      signal,
    });
    if (!response.ok)
      throw new Error(
        `读取视频资源失败（${response.status}），地址可能已过期或受防盗链限制`,
      );
    if (Number(response.headers.get("content-length")) > max) {
      await response.body?.cancel();
      throw new Error("视频资源超过大小限制");
    }
    const reader = response.body.getReader(),
      chunks = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > max || bytes + size > MAX_BYTES)
          throw new Error("视频分片合计超过 500 MB");
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
    }
    return { blob: new Blob(chunks), url: response.url || url };
  }
  async function manifest(url) {
    const result = await get(url, 2 * 1024 * 1024);
    const text = await result.blob.text();
    if (!text.trimStart().startsWith("#EXTM3U"))
      throw new Error("地址没有返回 m3u8 播放列表");
    return {
      lines: text
        .trim()
        .split(/\r?\n/)
        .map((s) => s.trim()),
      url: result.url,
    };
  }
  async function asset(value, base) {
    const url = httpUrl(value, base);
    if (downloads.has(url)) return downloads.get(url);
    if (++count > 1200) throw new Error("视频分片超过 1200 个");
    const name = `part-${count}.bin`;
    downloads.set(url, name);
    const { blob } = await get(url, MAX_BYTES - bytes);
    bytes += blob.size;
    files.set(name, blob);
    onProgress(`正在获取分片 ${count} · ${(bytes / 1048576).toFixed(1)} MB`);
    return name;
  }
  async function media(value, name) {
    const source = typeof value === "string" ? await manifest(value) : value;
    if (!source.lines.includes("#EXT-X-ENDLIST"))
      throw new Error("此播放列表仍在直播或未完整结束，目前只保存完整点播视频");
    if (source.lines.some((l) => l.startsWith("#EXT-X-STREAM-INF")))
      throw new Error("不支持多层嵌套的主播放列表");
    const output = [];
    for (let line of source.lines) {
      if (line.startsWith("#EXT-X-KEY:")) {
        const attrs = attributes(line);
        if (
          !["NONE", "AES-128"].includes(attrs.METHOD) ||
          (attrs.KEYFORMAT && attrs.KEYFORMAT !== "identity")
        )
          throw new Error("该视频使用受保护的加密格式，无法保存");
      }
      if (line.startsWith("#EXT-X-DEFINE") || line.includes("{$"))
        throw new Error("暂不支持变量播放列表");
      if (
        !line ||
        line.startsWith("#EXT-X-SESSION") ||
        line.startsWith("#EXT-X-I-FRAME") ||
        line.startsWith("#EXT-X-RENDITION") ||
        line.startsWith("#EXT-X-PART") ||
        line.startsWith("#EXT-X-PRELOAD")
      )
        continue;
      if (!line.startsWith("#")) line = await asset(line, source.url);
      else if (/URI="([^"]+)"/.test(line)) {
        const match = line.match(/URI="([^"]+)"/);
        line = line.replace(
          match[0],
          `URI="${await asset(match[1], source.url)}"`,
        );
      }
      output.push(line);
    }
    files.set(
      name,
      new Blob([output.join("\n") + "\n"], {
        type: "application/vnd.apple.mpegurl",
      }),
    );
  }
  const source = await manifest(url),
    variants = [];
  for (let i = 0; i < source.lines.length; i++)
    if (
      source.lines[i].startsWith("#EXT-X-STREAM-INF:") &&
      source.lines[i + 1] &&
      !source.lines[i + 1].startsWith("#")
    )
      variants.push({
        line: source.lines[i],
        url: httpUrl(source.lines[i + 1], source.url),
        attrs: attributes(source.lines[i]),
      });
  let label = "原始清晰度";
  if (variants.length) {
    variants.sort(
      (a, b) => Number(b.attrs.BANDWIDTH || 0) - Number(a.attrs.BANDWIDTH || 0),
    );
    const chosen =
      variants[quality >= 0 && quality < variants.length ? quality : 0];
    label =
      chosen.attrs.RESOLUTION ||
      `${Math.round(Number(chosen.attrs.BANDWIDTH) / 1000)} kbps`;
    await media(chosen.url, "video.m3u8");
    let master = "#EXTM3U\n";
    let streamLine = chosen.line.replace(
      /,?(SUBTITLES|CLOSED-CAPTIONS)=("[^"]*"|[^,]*)/g,
      "",
    );
    const audio = source.lines
      .filter((l) => l.startsWith("#EXT-X-MEDIA:"))
      .map((line) => ({ line, attrs: attributes(line) }))
      .filter(
        (a) =>
          a.attrs.TYPE === "AUDIO" &&
          a.attrs["GROUP-ID"] === chosen.attrs.AUDIO &&
          a.attrs.URI,
      )
      .sort(
        (a, b) =>
          Number(b.attrs.DEFAULT === "YES") - Number(a.attrs.DEFAULT === "YES"),
      )[0];
    if (audio) {
      await media(httpUrl(audio.attrs.URI, source.url), "audio.m3u8");
      master += audio.line.replace(/URI="[^"]*"/, 'URI="audio.m3u8"') + "\n";
    } else streamLine = streamLine.replace(/,?AUDIO="[^"]*"/, "");
    master += streamLine + "\nvideo.m3u8\n";
    files.set("index.m3u8", new Blob([master]));
  } else await media(source, "index.m3u8");
  onProgress(`分片已就绪 · ${label} · 正在上传并合并音视频`);
  return { files, bytes, label };
}
