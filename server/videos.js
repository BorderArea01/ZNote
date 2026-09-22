import { Worker } from 'node:worker_threads';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createHash } from 'node:crypto';

export const MAX_VIDEO_BYTES = 500 * 1024 * 1024;
const fail = (status, message) => Object.assign(new Error(message), { status });
const SMALL_CONTAINER_CHECK = 2 * 1024 * 1024;

function isoPayload(bytes) {
  let offset = 0;
  while (offset + 8 <= bytes.length) {
    let size = bytes.readUInt32BE(offset), header = 8;
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    if (size === 1) {
      if (offset + 16 > bytes.length) break;
      const large = Number(bytes.readBigUInt64BE(offset + 8));
      if (!Number.isSafeInteger(large)) break;
      size = large; header = 16;
    }
    if (size === 0) return type === 'mdat';
    if (size < header || offset + size > bytes.length) break;
    if (type === 'mdat') return true;
    offset += size;
  }
  return false;
}

// MediaInfo can read dimensions from an fMP4 initialization segment even when
// it contains no media payload. Reject that tiny, recognisable failure before
// it is stored as a seemingly valid but unplayable video.
export async function validateVideoPayload(path) {
  const { size } = await stat(path);
  if (size <= 0 || size > SMALL_CONTAINER_CHECK) return;
  const bytes = await readFile(path);
  if (bytes.length >= 8 && bytes.toString('ascii', 4, 8) === 'ftyp' && !isoPayload(bytes)) throw fail(415, '视频文件只有初始化片段，缺少可播放内容；请重新采集完整视频');
}

export function probeVideo(path) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./video-probe-worker.js', import.meta.url), { workerData: { path }, resourceLimits: { maxOldGenerationSizeMb: 128 } });
    let settled = false;
    const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); worker.terminate(); error ? reject(error) : resolve(value); };
    const timer = setTimeout(() => finish(fail(415, '视频分析超时，请检查文件是否完整')), 20000);
    worker.once('message', value => finish(value.error ? fail(415, '无法识别视频，请上传包含视频画面的 MP4、WebM、MOV 或 MKV 文件') : null, value));
    worker.once('error', () => finish(fail(415, '视频分析失败，请检查文件格式')));
    worker.once('exit', () => { if (!settled) finish(fail(415, '视频分析未完成')); });
  });
}
export async function fileDigest(path) {
  const hash = createHash('sha256'); let bytes = 0;
  for await (const chunk of createReadStream(path)) { hash.update(chunk); bytes += chunk.length; }
  return { hash: hash.digest('hex'), bytes };
}
export async function serveVideo(req, res, dataDir, item) {
  const path = join(dataDir, 'media', item.file_key), { size } = await stat(path);
  res.type(item.mime).set('Accept-Ranges', 'bytes').set('ETag', `"${item.hash}"`);
  let start = 0, end = size - 1;
  if (req.headers.range && (!req.headers['if-range'] || req.headers['if-range'] === `"${item.hash}"`)) {
    const match = req.headers.range.match(/^bytes=(\d*)-(\d*)$/);
    if (!match || (!match[1] && !match[2])) return res.status(416).set('Content-Range', `bytes */${size}`).end();
    if (match[1]) { start = Number(match[1]); end = match[2] ? Math.min(Number(match[2]), end) : end; }
    else { const suffix = Number(match[2]); if (!Number.isSafeInteger(suffix) || suffix <= 0) return res.status(416).set('Content-Range', `bytes */${size}`).end(); start = Math.max(0, size - suffix); }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) return res.status(416).set('Content-Range', `bytes */${size}`).end();
    res.status(206).set('Content-Range', `bytes ${start}-${end}/${size}`);
  }
  res.set('Content-Length', String(end - start + 1));
  if (req.method === 'HEAD') return res.end();
  await pipeline(createReadStream(path, { start, end }), res);
}
