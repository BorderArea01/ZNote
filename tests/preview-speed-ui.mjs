import {chromium} from 'playwright';import {createServer} from 'node:http';import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';import {resolve,join} from 'node:path';import sharp from 'sharp';import assert from 'node:assert/strict';
const dir=await mkdtemp(resolve('artifacts/preview-speed-')),extension=resolve('addons/browser/clipper');
const tiny=await sharp({create:{width:48,height:48,channels:3,background:'#467766'}}).png().toBuffer();
const medium=await sharp({create:{width:1000,height:700,channels:3,background:'#6e9b85'}}).jpeg().toBuffer();
const original=await sharp({create:{width:2400,height:1600,channels:3,background:'#6e9b85'}}).png().toBuffer();
const requests=[];
const server=createServer((req,res)=>{requests.push(req.url);if(req.url.startsWith('/tiny')){res.setHeader('Content-Type','image/png');return res.end(tiny);}if(req.url.startsWith('/preview')){res.setHeader('Content-Type','image/jpeg');return setTimeout(()=>res.end(medium),60);}if(req.url.startsWith('/original')){res.setHeader('Content-Type','image/png');return setTimeout(()=>res.end(original),req.url.includes('2.png')?2000:0);}
 res.setHeader('Content-Type','text/html;charset=utf-8');res.end('<!doctype html><title>小封面快速翻页</title><style>body{margin:40px;min-height:1500px;background:#eff5f1;font:18px system-ui}article{width:300px}img{width:48px;height:48px}</style><h1>48px 封面图</h1><article>'+[1,2,3,4,5].map(n=>`<img id="cover${n}" src="/tiny${n}.png" data-original="/original${n}.png" data-preview="http://127.0.0.1:${server.address().port}/preview${n}.jpg">`).join('')+'</article>');
});server.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
await mkdir(join(dir,'profile','Default'),{recursive:true});await mkdir(join(dir,'downloads'));await writeFile(join(dir,'profile','Default','Preferences'),JSON.stringify({download:{default_directory:join(dir,'downloads'),prompt_for_download:false}}));
const context=await chromium.launchPersistentContext(join(dir,'profile'),{channel:'msedge',headless:true,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`],viewport:{width:1440,height:1000}});
const page=await context.newPage(),worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');const cdp=await context.newCDPSession(page);await cdp.send('Browser.setDownloadBehavior',{behavior:'default'});
try {
 await page.goto(base);await page.locator('[data-znote-overlay]').waitFor({state:'attached'});await page.locator('#cover1').hover();const preview=page.locator('[data-znote-overlay]').locator('.preview');await preview.getByText('1 / 5',{exact:true}).waitFor();await preview.locator('small').filter({hasText:'快速预览'}).waitFor();
 for(let n=0;n<40&&!requests.includes('/preview2.jpg');n++)await page.waitForTimeout(25);assert.ok(requests.includes('/preview2.jpg'));await page.waitForTimeout(120);
 assert.ok(!requests.includes('/preview3.jpg'),'Do not preload whole work');assert.ok(!requests.includes('/original2.png'),'Preview must not fetch next original');
 const started=Date.now();await page.mouse.wheel(0,100);await preview.getByText('2 / 5',{exact:true}).waitFor();const elapsed=Date.now()-started;
 assert.ok(elapsed<700,`Cached flip took ${elapsed}ms`);assert.ok((await preview.locator('img').getAttribute('src')).endsWith('/preview2.jpg'));assert.equal(requests.filter(u=>u==='/preview2.jpg').length,1);
 assert.ok(!requests.includes('/original2.png'));assert.equal(await page.evaluate(()=>scrollY),0);
 await page.screenshot({path:resolve('artifacts/v086-fast-preview.png')});await page.keyboard.press('s');await preview.getByText('已交给浏览器下载',{exact:true}).waitFor();
 let downloads=[];for(let n=0;n<70;n++){downloads=await worker.evaluate(()=>chrome.downloads.search({}));if(downloads.some(d=>d.state==='complete'))break;await page.waitForTimeout(100);}
 const download=downloads.find(d=>d.state==='complete');assert.ok(download?.url.endsWith('/original2.png'));assert.deepEqual(await readFile(download.filename),original);
 await preview.getByRole('button',{name:'查看原图',exact:true}).click();await preview.locator('small').filter({hasText:'2400 × 1600 · 原图'}).waitFor();
 console.log(`PASS: 48px covers grouped; next preview preloaded once; flip ${elapsed}ms vs 2000ms original response; download bytes remain original; explicit original view works`);
}finally{await context.close();await new Promise(r=>server.close(r));}
