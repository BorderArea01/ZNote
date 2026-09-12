import {videoDetails} from '../shared/video-details.js';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, stat, rm } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { MAX_VIDEO_BYTES } from './videos.js';

const fail = (status, message) => Object.assign(new Error(message), { status });
export function platformUrl(value) {
  let url; try { url = new URL(value); } catch { throw fail(400, '请粘贴完整的视频页面链接'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port || url.href.length > 4096) throw fail(400, '视频链接格式不正确');
  const h = url.hostname, p = url.pathname;
  const valid = ((h === 'www.bilibili.com' || h === 'm.bilibili.com' || h === 'bilibili.com') && /^\/video\/(?:BV[\w]+|av\d+)/i.test(p)) ||
    (h === 'b23.tv' && /^\/[\w]+\/?$/.test(p)) ||
    (['www.douyin.com', 'douyin.com', 'www.iesdouyin.com'].includes(h) && /^\/(?:share\/)?video\/\d+/.test(p)) ||
    (h === 'v.douyin.com' && /^\/[\w-]+\/?$/.test(p)) ||
    (h === 'www.xiaohongshu.com' && /^\/(?:explore|discovery\/item)\/[a-f\d]+/i.test(p)) ||
    (h === 'xhslink.com' && /^\/(?:a\/)?[\w-]+\/?$/.test(p)) ||
    (['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com', 'mobile.twitter.com'].includes(h) && /^\/[\w]+\/status\/\d+/.test(p));
  if (!valid) throw fail(400, '目前支持哔哩哔哩、抖音、小红书和 X 的单条视频链接（不支持主页或直播）');
  url.protocol = 'https:'; url.hash = ''; return url.href;
}

export function mediaTools() {
  const local = resolve('tools/media', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
  let ffmpeg = process.env.ZNOTE_FFMPEG;
  if (!ffmpeg) { try { ffmpeg = createRequire(import.meta.url)('ffmpeg-static'); } catch {} }
  return { downloader: process.env.ZNOTE_YTDLP || (existsSync(local) ? local : 'yt-dlp'), ffmpeg: ffmpeg && existsSync(ffmpeg) ? ffmpeg : 'ffmpeg' };
}
async function resolveShareLink(value, signal) {
  let url = platformUrl(value);
  for (let i = 0; i < 5; i++) {
    if (!['b23.tv','v.douyin.com','xhslink.com'].includes(new URL(url).hostname)) return url;
    const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]) });
    await response.body?.cancel();
    if (![301,302,303,307,308].includes(response.status) || !response.headers.get('location')) throw fail(422, '分享链接没有返回视频页面，请打开分享链接后复制浏览器地址');
    // Validate each destination before another request, including shortened share links.
    url = platformUrl(new URL(response.headers.get('location'), url).href);
  }
  throw fail(422, '分享链接跳转过多，请复制最终视频页面地址');
}
function run(command, args, { signal, cwd, onText = () => {}, timeout = 600000, acceptedCodes = [0] } = {}) {
  return new Promise((yes, no) => {
    const child = spawn(command, args, { cwd, windowsHide: true, detached: process.platform !== 'win32', shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let tail = '', settled = false, aborted = false;
    const finish = (error) => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); error ? no(error) : yes(tail); };
    const abort = () => {
      aborted = true;
      // Include ffmpeg children on Windows; POSIX yt-dlp handles SIGTERM itself.
      if (process.platform === 'win32' && child.pid) { const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); killer.on('error', () => child.kill()); }
      else { try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); } }
    };
    const timer = setTimeout(abort, timeout);
    signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
    child.on('error', error => finish(error.code === 'ENOENT' ? fail(503, '服务器尚未安装视频采集组件，请运行 npm run media:setup') : error));
    for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { const text = chunk.toString(); tail = (tail + text).slice(-16000); onText(text); });
    child.on('close', code => finish(aborted ? fail(408, '采集已取消或超过 10 分钟，请重试') : !acceptedCodes.includes(code) ? fail(422, friendlyError(tail)) : null));
  });
}
function friendlyError(text) {
  if (text.includes('ERROR:')) text = text.slice(text.lastIndexOf('ERROR:'));
  if (/cookies|login|sign in|confirm.*bot|403|412|429|blocked|risk|captcha|验证|登录/i.test(text)) return '平台要求登录、验证或限制了访问。请在浏览器打开原页面；可下载后上传文件，图片可用右键采集。';
  if (/too large|max.filesize|larger than/i.test(text)) return '视频超过 500 MB，未入库';
  if (/not available|unavailable|404|removed|private|not found/i.test(text)) return '视频已删除、非公开或暂不可访问，请检查原页面';
  if (/timed out|resolve|connection|network|SSL|TLS|protocol/i.test(text)) return '无法连接资源平台，请检查服务器网络后重试';
  if (/no video|no formats|unsupported url|extract/i.test(text)) return '未解析到可下载的视频；可能是图文帖子、分享链接失效或平台规则变化。图片请使用右键采集。';
  return '平台未返回可用视频，采集未完成。请检查原页面或下载后上传文件。';
}
export { run as runMediaCommand };
export async function downloadVideo({ url, dir, signal, progress }) {
  const { downloader, ffmpeg } = mediaTools();
  url = await resolveShareLink(url, signal);
  await run(ffmpeg, ['-version'], { signal, timeout: 10000 });
  const args = ['--ignore-config', '--no-playlist', '--playlist-items', '1', '--no-cache-dir', '--no-warnings', '--newline', '--socket-timeout', '20', '--retries', '1', '--fragment-retries', '1', '--concurrent-fragments', '1', '--max-filesize', String(MAX_VIDEO_BYTES), '--max-downloads', '1', '--no-write-thumbnail', '--write-info-json', '--no-write-playlist-metafiles', '--ffmpeg-location', ffmpeg === 'ffmpeg' ? ffmpeg : dirname(ffmpeg), '-f', 'bv[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b[ext=webm]/b', '--merge-output-format', 'mp4', '-o', join(dir, 'media.%(ext)s'), '--', url];
  args.splice(1, 0, '--use-extractors', 'BiliBili,Douyin,XiaoHongShu,Twitter');
  const controller = new AbortController();
  const abort = () => controller.abort(); signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
  let overLimit = false;
  const budget = setInterval(async () => {
    try { const files = await readdir(dir); const sizes = await Promise.all(files.map(name => stat(join(dir, name)))); if (sizes.reduce((n, s) => n + s.size, 0) > MAX_VIDEO_BYTES * 3) { overLimit = true; abort(); } } catch {}
  }, 1000);
  try {
    // yt-dlp uses exit 101 when our one-video download limit is reached.
    // Still require exactly one finished, size-bounded video below before accepting it.
    await run(downloader, args, { signal: controller.signal, cwd: dir, acceptedCodes: [0, 101], onText: text => { const matches = [...text.matchAll(/\[download\]\s+([\d.]+)%/g)]; if (matches.length) progress(`正在下载媒体流 ${matches.at(-1)[1]}%`); if (/Merger/.test(text)) progress('正在合并画面与声音（不重新编码）'); } });
  } catch (e) { if (overLimit) throw fail(413, '临时下载超过空间上限，已终止'); throw e; }
  finally { clearInterval(budget); signal.removeEventListener('abort', abort); }
  const files = await readdir(dir), media = files.filter(name => /^media\.(mp4|webm|mov)$/i.test(name));
  if (media.length !== 1) throw fail(422, '未得到完整的 MP4 / WebM 视频，未入库');
  const path = join(dir, media[0]); if ((await stat(path)).size > MAX_VIDEO_BYTES) throw fail(413, '视频超过 500 MB，未入库');
  let metadata = {}; const info = join(dir, 'media.info.json');
  if (existsSync(info) && (await stat(info)).size < 5 * 1024 * 1024) { try { metadata = JSON.parse(await readFile(info, 'utf8')); } catch {} }
  return { path, originalname: media[0], title: String(metadata.title || '网络视频').slice(0, 200), description: String(metadata.description || '').slice(0, 100000), author: metadata.uploader || metadata.creator || metadata.channel || '', author_url: metadata.uploader_url || metadata.channel_url || '' };
}

export function createImportManager({ dataDir, save, downloader = downloadVideo }) {
  const jobs = new Map(); let running = false, stopped = false, pending = Promise.resolve();
  const root = resolve(dataDir, 'imports');
  const ready = (async () => {
    await mkdir(root, { recursive: true });
    // Recover abandoned download folders after a process crash, under this instance's data directory only.
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.isSymbolicLink() && /^job-[a-zA-Z0-9]{6}$/.test(entry.name)) {
        const target = resolve(root, entry.name);
        if (dirname(target) === root) await rm(target, { recursive: true, force: true });
      }
    }
  })();
  ready.catch(() => {});
  const publicJob = job => { const { controller, input, ...rest } = job; return rest; };
  async function pump() {
    if (running || stopped) return; running = true;
    try {
      for (const job of jobs.values()) {
        if (job.status !== 'queued' || stopped) continue;
        let dir;
        try {
          job.status = 'running'; job.message = '正在解析平台视频';
          await ready; if (job.controller.signal.aborted) throw fail(409, '采集已取消'); dir = await mkdtemp(join(root, 'job-'));
          const file = await downloader({ url: job.source_url, dir, signal: job.controller.signal, progress: message => { job.message = message; } });
          if (job.controller.signal.aborted) throw fail(409, '采集已取消');
          job.message = '正在验证视频并入库'; job.status = 'saving';
          const details=videoDetails(file,job.input.tags);
          const item = await save(file, { ...job.input, ...details, content:[details.content,file.description||''].filter(Boolean).join('\n\n'), source_url: job.source_url });
          job.item_id = item.id; job.duplicate = !!item.duplicate; job.status = 'completed'; job.message = item.duplicate ? '知识库已收录此视频，已补充来源' : '视频已入库';
        } catch (e) { job.status = job.controller.signal.aborted ? 'cancelled' : 'failed'; job.message = job.status === 'cancelled' ? '采集已取消' : (e.status ? e.message : '采集处理失败，请检查存储空间后重试'); }
        finally {
          // dir is created by mkdtemp beneath our dedicated imports root, never from remote metadata.
          if (dir && dirname(dir) === resolve(dataDir, 'imports')) await rm(dir, { recursive: true, force: true }).catch(() => {});
          job.finished_at = new Date().toISOString();
        }
      }
    } finally { running = false; }
  }
  return {
    list: () => [...jobs.values()].reverse().map(publicJob),
    get(id) { const job = jobs.get(id); if (!job) throw fail(404, '采集记录不存在，服务重启会清空记录'); return publicJob(job); },
    add(input) {
      if (stopped) throw fail(503, '服务正在停止');
      if ([...jobs.values()].filter(j => ['queued','running','saving'].includes(j.status)).length >= 8) throw fail(429, '采集队列已满，请稍后再试');
      const source_url = platformUrl(input.url);
      const same = [...jobs.values()].find(j => ['queued','running','saving'].includes(j.status) && j.source_url === source_url && j.input.collection_id === input.collection_id); if (same) return publicJob(same);
      while (jobs.size >= 50) { const old = [...jobs.values()].find(j => !['queued','running','saving'].includes(j.status)); if (!old) break; jobs.delete(old.id); }
      const job = { id: randomUUID(), status: 'queued', message: '等待采集', source_url, created_at: new Date().toISOString(), input, controller: new AbortController() }; jobs.set(job.id, job);
      pending = Promise.resolve().then(pump); return publicJob(job);
    },
    cancel(id) { const job = jobs.get(id); if (!job) throw fail(404, '采集记录不存在'); if (job.status === 'saving') throw fail(409, '正在入库，请等待完成'); if (['queued','running'].includes(job.status)) { job.controller.abort(); if (job.status === 'queued') { job.status = 'cancelled'; job.message = '采集已取消'; } } return publicJob(job); },
    async cancelAll() { for (const job of jobs.values()) { if (job.status === 'queued') { job.status = 'cancelled'; job.message = '备份恢复中，采集已取消'; } job.controller.abort(); } while (running) await new Promise(r => setTimeout(r, 25)); },
    async stop() { stopped = true; for (const job of jobs.values()) job.controller.abort(); while (running) await new Promise(r => setTimeout(r, 25)); await pending; await ready.catch(() => {}); },
  };
}
