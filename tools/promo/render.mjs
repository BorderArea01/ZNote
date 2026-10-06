import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = dirname(fileURLToPath(import.meta.url));
const root = join(source, '../../output/promo-znote');
const command = process.argv[2] || '--stills';
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (!['/', '/index.html', '/storyboard.json'].includes(pathname)) { res.writeHead(404).end(); return; }
  const path = join(source, pathname === '/' ? 'index.html' : pathname.slice(1));
  const body = await readFile(path);
  res.setHeader('content-type', extname(path) === '.json' ? 'application/json; charset=utf-8' : 'text/html; charset=utf-8');
  res.end(body);
});
server.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1,
    ...(command === '--video' ? { recordVideo: { dir: join(root, 'render-cache'), size: { width: 1280, height: 720 } } } : {}) });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.body.dataset.ready === 'true');
  const { duration, scenes } = await page.evaluate(() => ({ duration: ZNotePromo.duration, scenes: ZNotePromo.scenes }));
  if (command === '--stills') {
    await mkdir(join(root, 'stills'), { recursive: true });
    for (const [i, scene] of scenes.entries()) {
      await page.evaluate(t => ZNotePromo.seek(t), scene.start + Math.min(2.1, scene.seconds / 2));
      await page.waitForTimeout(450);
      await page.screenshot({ path: join(root, 'stills', `${String(i).padStart(2, '0')}-${scene.id}.png`) });
    }
    console.log(JSON.stringify({ mode: 'stills', count: scenes.length, duration, errors }));
  } else if (command === '--video') {
    await mkdir(join(root, 'render-cache'), { recursive: true });
    const video = page.video();
    await page.evaluate(() => ZNotePromo.play());
    await page.waitForTimeout((duration + 0.5) * 1000);
    await context.close();
    const output = join(root, 'render-cache', 'visual.webm');
    await video.saveAs(output);
    console.log(JSON.stringify({ mode: 'video', duration, output, errors }));
  } else throw new Error(`Unknown command: ${command}`);
  if (errors.length) process.exitCode = 1;
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
