import { Worker } from 'node:worker_threads';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createHash } from 'node:crypto';

export const MAX_VIDEO_BYTES = 500 * 1024 * 1024;
const fail = (status, message) => Object.assign(new Error(message), { status });
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
