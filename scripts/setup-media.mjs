import { mkdir, writeFile, readFile, chmod, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const version = '2026.08.19';
const asset = process.platform === 'win32' ? 'yt-dlp.exe' : process.platform === 'darwin' ? 'yt-dlp_macos' : process.arch === 'arm64' ? 'yt-dlp_linux_aarch64' : 'yt-dlp_linux';
if (!['win32','darwin','linux'].includes(process.platform) || !['x64','arm64'].includes(process.arch) || (process.platform === 'win32' && process.arch !== 'x64')) throw new Error('请安装系统 yt-dlp 并设置 ZNOTE_YTDLP');
const dir = resolve('tools/media'); await mkdir(dir, { recursive: true });
const base = `https://github.com/yt-dlp/yt-dlp/releases/download/${version}/`;
async function get(name) { const response = await fetch(base + name, { signal: AbortSignal.timeout(180000) }); if (!response.ok) throw new Error(`下载 ${name} 失败：${response.status}`); return Buffer.from(await response.arrayBuffer()); }
const sums = (await get('SHA2-256SUMS')).toString(), binary = await get(asset);
const expected = sums.split('\n').map(s => s.trim().split(/\s+/)).find(s => s[1] === asset)?.[0];
if (!expected || createHash('sha256').update(binary).digest('hex') !== expected) throw new Error('yt-dlp 校验失败');
const target = resolve(dir, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
await writeFile(target + '.download', binary); await chmod(target + '.download', 0o755); await rename(target + '.download', target);
await writeFile(resolve(dir, 'VERSION'), version + '\n');
await writeFile(resolve(dir, 'README.txt'), 'yt-dlp official release: ' + base + '\nLicense and source: https://github.com/yt-dlp/yt-dlp\nFFmpeg binary sources/license: node_modules/ffmpeg-static/README.md and ffmpeg executable LICENSE/README files.\n');
const system = spawnSync(process.env.ZNOTE_FFMPEG || 'ffmpeg', ['-version'], { windowsHide: true, stdio: 'ignore' });
if (system.status !== 0) {
  if (process.platform === 'linux') throw new Error('请先用系统包管理器安装 FFmpeg（Debian/Ubuntu：sudo apt install ffmpeg），或设置 ZNOTE_FFMPEG 为有效可执行文件路径');
  const result = spawnSync(process.execPath, ['node_modules/ffmpeg-static/install.js'], { windowsHide: true, stdio: 'inherit' });
  if (result.status !== 0) throw new Error('请安装 ffmpeg 或设置 ZNOTE_FFMPEG 为可执行文件路径');
}
console.log(`视频采集组件就绪：yt-dlp ${version}`);
