export const MAX_DIRECT_VIDEO_BYTES = 500 * 1024 * 1024;
const RANGE_CHUNK_BYTES = 8 * 1024 * 1024;

export function parseContentRange(value) {
  const match = String(value || '').match(/^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i);
  if (!match) return null;
  const start = Number(match[1]), end = Number(match[2]);
  const total = match[3] === '*' ? null : Number(match[3]);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start || (total !== null && (!Number.isSafeInteger(total) || end >= total))) return null;
  return { start, end, total };
}

async function readBytes(response, maxBytes) {
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > maxBytes) throw new Error('视频超过 500 MB');
  if (!response.body?.getReader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) throw new Error('视频超过 500 MB');
    return bytes;
  }
  const reader = response.body.getReader(), chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error('视频超过 500 MB');
      chunks.push(value);
    }
  } finally {
    reader.releaseLock?.();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

async function fetchRanges(url, total, type, { signal, credentials, fetcher, chunkSize = RANGE_CHUNK_BYTES }) {
  if (!Number.isSafeInteger(total) || total <= 0 || total > MAX_DIRECT_VIDEO_BYTES) throw new Error('视频分段大小无效或超过 500 MB');
  if (!Number.isSafeInteger(chunkSize) || chunkSize <= 0 || chunkSize > RANGE_CHUNK_BYTES) throw new Error('视频分段大小无效');
  const chunks = [];
  let offset = 0;
  while (offset < total) {
    const end = Math.min(total - 1, offset + chunkSize - 1);
    const response = await fetcher(url, { credentials, signal, headers: { Range: `bytes=${offset}-${end}` } });
    if (!response.ok) throw new Error(`读取视频分段失败 ${response.status}`);
    const bytes = await readBytes(response, MAX_DIRECT_VIDEO_BYTES);
    if (response.status === 200) {
      if (bytes.byteLength !== total) throw new Error('视频地址返回的文件不完整，无法保存');
      return new Blob([bytes], { type });
    }
    if (response.status !== 206) throw new Error('视频地址未返回可拼接的分段');
    const range = parseContentRange(response.headers.get('content-range'));
    if (range) {
      if (range.total !== total || range.start !== offset || bytes.byteLength !== range.end - range.start + 1) throw new Error('视频分段范围不连续，无法保存完整文件');
      offset = range.end + 1;
    } else {
      // Some CDNs (including video.twimg.com) expose 206 to the extension
      // webRequest API but do not expose Content-Range to fetch. The requested
      // range is still trustworthy when the response is exactly that size.
      const expected = end - offset + 1;
      if (bytes.byteLength !== expected) throw new Error('视频分段范围不连续，无法保存完整文件');
      offset = end + 1;
    }
    chunks.push(bytes);
  }
  return new Blob(chunks, { type });
}

export async function readCompleteVideo(url, { signal, credentials = 'include', expectedTotal = 0, fetcher = globalThis.fetch, chunkSize = RANGE_CHUNK_BYTES } = {}) {
  const response = await fetcher(url, { credentials, signal });
  if (!response.ok) throw new Error('视频文件访问失败，可改用页面视频采集或下载后上传');
  const type = response.headers.get('content-type') || 'video/mp4';
  const range = parseContentRange(response.headers.get('content-range'));
  const contentLength = Number(response.headers.get('content-length') || 0);
  const declared = range?.total || Math.max(contentLength, Number(expectedTotal) || 0);
  if (declared > MAX_DIRECT_VIDEO_BYTES) throw new Error('视频超过 500 MB');
  const bytes = await readBytes(response, MAX_DIRECT_VIDEO_BYTES);
  const incomplete = declared > bytes.byteLength || (response.status === 206 && (!range || range.start !== 0 || range.end + 1 < declared));
  if (incomplete) {
    if (!declared) throw new Error('视频地址只返回分段数据，未提供完整文件大小；请使用“采集此页面的视频”');
    return fetchRanges(url, declared, type, { signal, credentials, fetcher, chunkSize });
  }
  if (response.status === 206 && (!range || range.start !== 0)) throw new Error('视频地址只返回分段数据，无法取得完整文件；请使用“采集此页面的视频”');
  return new Blob([bytes], { type });
}

function hasBytes(bytes, signature) {
  outer: for (let i = 0; i <= bytes.length - signature.length; i++) {
    for (let j = 0; j < signature.length; j++) if (bytes[i + j] !== signature[j]) continue outer;
    return true;
  }
  return false;
}

function isoBoxes(bytes) {
  const boxes = new Set();
  let offset = 0;
  while (offset + 8 <= bytes.length) {
    let size = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    let header = 8;
    if (size === 1) {
      if (offset + 16 > bytes.length) break;
      const view = new DataView(bytes.buffer, bytes.byteOffset + offset + 8, 8);
      const large = view.getBigUint64(0);
      if (large > BigInt(Number.MAX_SAFE_INTEGER)) break;
      size = Number(large); header = 16;
    }
    if (size === 0) { boxes.add(type); break; }
    if (size < header || offset + size > bytes.length) break;
    boxes.add(type); offset += size;
  }
  return boxes;
}

// A tiny fMP4 init segment can pass MediaInfo because it contains dimensions
// in `moov`, while it has no media payload and cannot be played. Reject only
// small, recognisable container headers here; large files are validated by
// the server probe without copying their full contents in the extension.
export async function isLikelyCompleteVideo(blob) {
  if (!blob || blob.size > 2 * 1024 * 1024) return true;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const type = String(blob.type || '').toLowerCase();
  if (type.includes('mp4') || type.includes('quicktime') || hasBytes(bytes, [0x66, 0x74, 0x79, 0x70])) {
    const boxes = isoBoxes(bytes);
    return boxes.has('mdat');
  }
  if (type.includes('webm') || type.includes('matroska') || hasBytes(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return hasBytes(bytes, [0x1f, 0x43, 0xb6, 0x75]);
  return true;
}

export async function readPlayableVideo(url, options = {}) {
  const blob = await readCompleteVideo(url, options);
  const mime = blob.type || 'video/mp4';
  if (mime && !/^(video\/|application\/octet-stream)/i.test(mime)) throw new Error('此地址不是直接视频文件，请使用页面视频采集');
  if (blob.size > MAX_DIRECT_VIDEO_BYTES) throw new Error('视频超过 500 MB');
  if (!await isLikelyCompleteVideo(blob)) throw new Error('源站只返回了视频初始化片段，无法播放；请改用“采集此页面的视频”');
  return blob;
}
