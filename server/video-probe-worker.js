import { parentPort, workerData } from 'node:worker_threads';
import { open } from 'node:fs/promises';
import mediaInfoFactory from 'mediainfo.js';
let handle, probe;
try {
  handle = await open(workerData.path, 'r'); const { size } = await handle.stat();
  probe = await mediaInfoFactory({ format: 'object' });
  const result = await probe.analyzeData(size, async (length, position) => {
    const buffer = Buffer.alloc(Math.min(length, 1024 * 1024));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, position); return buffer.subarray(0, bytesRead);
  });
  const tracks = result.media?.track || [], general = tracks.find(t => t['@type'] === 'General'), video = tracks.find(t => t['@type'] === 'Video');
  const formats = {
    'MPEG-4': ['mp4', 'video/mp4'],
    WebM: ['webm', 'video/webm'],
    QuickTime: ['mov', 'video/quicktime'],
    Matroska: ['mkv', 'video/x-matroska'],
  };
  if (!video || !Number(video.Width) || !Number(video.Height) || !formats[general?.Format]) throw Error('Unsupported video');
  const [extension, mime] = /^qt\s*$/i.test(String(general.CodecID || '')) ? ['mov', 'video/quicktime'] : formats[general.Format];
  const duration = Number(video.Duration || general.Duration);
  parentPort.postMessage({ width: Number(video.Width), height: Number(video.Height), duration: Number.isFinite(duration) && duration > 0 ? duration : null, codec: String(video.Format || 'unknown').slice(0, 80), extension, mime });
} catch { parentPort.postMessage({ error: true }); }
finally { probe?.close(); await handle?.close(); }
