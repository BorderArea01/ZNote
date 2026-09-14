// ZNote Pixiv enhanced distribution builder, GPL-3.0-or-later.
import { build } from 'esbuild';
import archiver from 'archiver';
import yauzl from 'yauzl';
import { spawnSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { readFile, writeFile, mkdir, cp, readdir } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), base = join(root, 'integrations/pixiv'), out = join(base, 'build');
const spec = JSON.parse(await readFile(join(base, 'upstream.json'), 'utf8'));
await mkdir(out, { recursive: true });
const arg = process.argv.indexOf('--archive');
const archivePath = arg >= 0 ? resolve(process.argv[arg + 1]) : join(out, 'upstream.zip');
if (arg < 0) {
  try { await readFile(archivePath); } catch {
    const r = spawnSync('gh', ['api', `repos/${spec.repository}/zipball/${spec.commit}`], { windowsHide: true, maxBuffer: 150e6 });
    if (r.status === 0) await writeFile(archivePath, r.stdout);
    else {
      const response = await fetch(`https://api.github.com/repos/${spec.repository}/zipball/${spec.commit}`, { headers: { 'User-Agent': 'ZNote-build' }, signal: AbortSignal.timeout(120000) });
      if (!response.ok) throw Error('Unable to fetch pinned upstream: HTTP ' + response.status);
      await writeFile(archivePath, Buffer.from(await response.arrayBuffer()));
    }
  }
}
// Extract into a fresh build directory. Never delete an existing user checkout.
const work = join(out, 'source-' + Date.now()); await mkdir(work);
await new Promise((resolveDone, reject) => yauzl.open(archivePath, { lazyEntries: true }, (error, zip) => {
  if (error) return reject(error); let bytes = 0;
  zip.on('error', reject); zip.on('end', resolveDone);
  zip.on('entry', async entry => {
    try {
      const parts = entry.fileName.split('/');
      if (!parts[0].endsWith('-' + spec.commit.slice(0,7)) || parts.some(p => p === '..' || p.includes('\\')) || entry.fileName.startsWith('/')) throw Error('Unexpected upstream archive path');
      const path = join(work, ...parts.slice(1)); bytes += entry.uncompressedSize;
      if (bytes > 300e6) throw Error('Upstream archive exceeds source budget');
      if (entry.fileName.endsWith('/')) { await mkdir(path, { recursive: true }); zip.readEntry(); return; }
      await mkdir(dirname(path), { recursive: true });
      zip.openReadStream(entry, async (error, stream) => { if (error) return reject(error); try { await pipeline(stream, createWriteStream(path)); zip.readEntry(); } catch (e) { reject(e); zip.close(); } });
    } catch (e) { reject(e); zip.close(); }
  }); zip.readEntry();
}));
const deps = join(out, 'deps');
await mkdir(deps, { recursive: true });
await writeFile(join(deps, 'package.json'), JSON.stringify({ private: true, dependencies: { 'webextension-polyfill': '0.12.0' } }));
const npm = process.env.npm_execpath;
if (!npm) throw Error('Run this builder using npm run pixiv:build');
const installed = spawnSync(process.execPath, [npm, 'install', '--prefix', deps, '--ignore-scripts', '--no-audit', '--no-fund'], { windowsHide: true, encoding: 'utf8' });
if (installed.status) throw Error(installed.stderr); console.log('Pinned upstream and bridge dependencies ready');
const src = join(work, 'src/ts'), bridge = join(src, 'znote'); await mkdir(bridge, { recursive: true });
for (const name of ['store.js','records.js','background.js','routing.ts']) await cp(join(base, 'bridge', name), join(bridge, name));
await cp(join(base, 'bridge/capture.ts'), join(bridge, 'Capture.ts'));
// Only suppress native auto-download for the exact result array explicitly
// routed to the library. Ordinary native actions keep their saved behavior.
for (const [file, signature, addition] of [
  ['download/DownloadControl.ts', '    // 是否自动开始下载', '\n    if (libraryRouting.handled(store.result)) return'],
  ['crawl/InitPageBase.ts', '  protected confirmRecrawl() {', '\n    if (libraryRouting.handled(store.result)) return true'],
  ['download/Resume.ts', '  private async saveDataInner() {', '\n    if (libraryRouting.handled(store.result)) return'],
  ['download/Resume.ts', '  private bindEvents() {', '\n    window.addEventListener(EVT.list.downloadStart, () => {\n      if (libraryRouting.handled(store.result)) { libraryRouting.release(store.result); this.saveData() }\n    })'],
]) {
  const path = join(src, file), source = await readFile(path, 'utf8');
  if (source.split(signature).length !== 2) throw Error('Pinned upstream routing hook changed: ' + file);
  const header = "import { libraryRouting } from '../znote/routing'\n";
  await writeFile(path, (source.startsWith(header) ? '' : header) + source.replace(signature, signature + addition));
}
for (const [file, addition] of [['content.ts', "\nimport './znote/Capture'\n"], ['serviceWorker/background.ts', "\nimport '../znote/background.js'\n"]]) {
  const path = join(src, file); await writeFile(path, await readFile(path, 'utf8') + addition);
}
const dist = join(out, 'extension'); await mkdir(dist, { recursive: true });
await cp(join(work, 'dist'), dist, { recursive: true });
const manifest = JSON.parse(await readFile(join(work, 'src/manifest.json'), 'utf8'));
manifest.name = 'ZNote Pixiv 增强版（基于 Powerful Pixiv Downloader）';
if (!Number.isInteger(spec.extensionRevision) || spec.extensionRevision < 1 || spec.extensionRevision > 65535) throw Error('Invalid extension revision');
manifest.version = spec.version + '.' + spec.extensionRevision; manifest.version_name = `${spec.version} + ZNote ${spec.bridgeVersion}`;
manifest.key = (await readFile(join(base, 'public-key.txt'), 'utf8')).trim();
manifest.optional_host_permissions = ['http://*/*', 'https://*/*'];
manifest.permissions = [...new Set([...manifest.permissions, 'offscreen', 'alarms'])];
manifest.options_ui = { page: 'znote/index.html', open_in_tab: true };
delete manifest.browser_specific_settings; delete manifest.background.scripts; delete manifest.background.preferred_environment;
await writeFile(join(dist, 'manifest.json'), JSON.stringify(manifest, null, 2));
await build({ entryPoints: { content: join(src, 'content.ts'), injectScript: join(src, 'injectScript.ts'), background: join(src, 'serviceWorker/background.ts') }, outdir: join(dist, 'js'), bundle: true, platform: 'browser', target: 'chrome120', format: 'iife', loader: { '.html': 'text' }, nodePaths: [join(deps, 'node_modules')], legalComments: 'eof', sourcemap: true });
await cp(join(base, 'bridge'), join(dist, 'znote'), { recursive: true });
await build({ entryPoints: [join(base, 'bridge/index.js')], outfile: join(dist, 'znote/index.js'), bundle: true, format: 'esm', platform: 'browser', target: 'chrome120', legalComments: 'eof', sourcemap: true });
await build({ entryPoints: [join(base, 'bridge/runner.js')], outfile: join(dist, 'znote/runner.js'), bundle: true, format: 'esm', platform: 'browser', target: 'chrome120', legalComments: 'eof', sourcemap: true });
await cp(join(root, 'node_modules/turndown/LICENSE'), join(dist, 'znote/turndown-LICENSE'));
await cp(join(base, 'LICENSE'), join(dist, 'LICENSE'));
await cp(join(base, 'README.md'), join(dist, 'ZNOTE-README.md'));
await writeFile(join(dist, 'SOURCE.txt'), `Based on ${spec.repository}@${spec.commit}, GPL-3.0-or-later.\nZNote changes: https://github.com/BorderArea01/ZNote/tree/main/integrations/pixiv\nComplete corresponding source: ZNote Settings > Pixiv enhanced > GPL full source (/api/clipper/pixiv/source).\n`);
async function pack(file, append) {
  const output = createWriteStream(file), zip = archiver('zip', { zlib: { level: 6 } });
  const done = new Promise((yes, no) => { output.on('close', yes); output.on('error', no); zip.on('error', no); });
  zip.pipe(output); append(zip); await zip.finalize(); await done;
}
await pack(join(out, 'znote-pixiv.zip'), zip => zip.directory(dist, false));
// Self-contained corresponding source: pinned upstream archive, all bridge
// modifications, and the exact build script/dependency manifest.
await pack(join(out, 'source.zip'), zip => {
  zip.file(archivePath, { name: 'upstream.zip' });
  zip.directory(join(base, 'bridge'), 'integrations/pixiv/bridge');
  for (const file of ['upstream.json','public-key.txt','LICENSE','README.md']) zip.file(join(base, file), { name: 'integrations/pixiv/' + file });
  zip.file(fileURLToPath(import.meta.url), { name: 'scripts/build-pixiv.mjs' });
  zip.append(JSON.stringify({ private: true, type: 'module', scripts: { 'pixiv:build': 'node scripts/build-pixiv.mjs --archive upstream.zip' }, dependencies: { esbuild: '0.28.2', archiver: '7.0.1', yauzl: '3.4.0', turndown: '7.2.4' } }, null, 2), { name: 'package.json' });
  zip.append('Install Node.js 24+, run npm install, then npm run pixiv:build. The bundled upstream.zip is the pinned unmodified upstream source.\n', { name: 'BUILD.txt' });
});
console.log(`Built ${manifest.version_name}\n${dist}\nComplete source: ${join(out, 'source.zip')}`);
