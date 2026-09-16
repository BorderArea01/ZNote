import { chromium } from 'playwright';
import {createServer} from 'node:http';
import {mkdtemp,readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import sharp from 'sharp';
import assert from 'node:assert/strict';
const dir=await mkdtemp(resolve('artifacts/gallery-ui-')),extension=resolve('addons/browser/clipper');
const images=await Promise.all(['#638f80','#a88060','#746890'].map(background=>sharp({create:{width:1200,height:800,channels:3,background}}).png().toBuffer()));
let fail=true, slow=false;
const source=createServer((req,res)=>{
 const n=req.url.match(/^\/p([123])\.png/);
 if(n){if(n[1]==='3'&&fail){res.writeHead(404);return res.end();}res.setHeader('Content-Type','image/png');if(n[1]==='2'&&slow){setTimeout(()=>res.end(images[1]),2000);return;}return res.end(images[Number(n[1])-1]);}
 res.setHeader('Content-Type','text/html;charset=utf-8');res.end('<!doctype html><title>漫画测试作品</title><style>body{margin:40px;background:#eef5f1;font:18px system-ui}img{width:260px;height:174px;object-fit:cover}article{width:280px}aside{position:absolute;right:30px;top:50px}</style><h1>漫画测试作品</h1><article><img id="first" src="/p1.png"><img src="/p2.png"><img src="/p3.png"></article><aside><img src="/recommendation.png" alt="推荐不能混入"></aside>');
});source.listen(0,'127.0.0.1');await new Promise(r=>source.once('listening',r));const base=`http://127.0.0.1:${source.address().port}`;
await mkdir(join(dir,'profile','Default'),{recursive:true});await mkdir(join(dir,'downloads'));
await writeFile(join(dir,'profile','Default','Preferences'),JSON.stringify({download:{default_directory:join(dir,'downloads'),prompt_for_download:false,directory_upgrade:true}}));
const context=await chromium.launchPersistentContext(join(dir,'profile'),{channel:'msedge',headless:true,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`],viewport:{width:1440,height:1000}});
const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker'),page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
// Native browser download handling preserves extension-provided subfolders and filenames.
const cdp=await context.newCDPSession(page);await cdp.send('Browser.setDownloadBehavior',{behavior:'default'});
try{
 await page.goto(base);await page.locator('[data-znote-overlay]').waitFor({state:'attached'});await page.locator('#first').hover();
 const preview=page.locator('[data-znote-overlay]').locator('.preview');await preview.getByText('1 / 3',{exact:true}).waitFor();
 await preview.getByRole('button',{name:'下一张',exact:true}).hover();await page.mouse.wheel(0,100);
 await preview.getByText('2 / 3',{exact:true}).waitFor();assert.ok((await preview.locator('img').getAttribute('src')).endsWith('/p2.png'));assert.equal(await page.evaluate(()=>scrollY),0);
 await page.waitForTimeout(250);await page.mouse.wheel(0,-100);await preview.getByText('1 / 3',{exact:true}).waitFor();assert.ok(await preview.getByRole('button',{name:'上一张',exact:true}).isDisabled());
 await page.screenshot({path:resolve('artifacts/v084-gallery-hover.png')});
 const opened=context.waitForEvent('page');await preview.getByRole('button',{name:'批量下载 3 张',exact:true}).click();const gallery=await opened;gallery.on('pageerror',e=>errors.push(e.message));
 await gallery.locator('#status').filter({hasText:'2 / 3 张'}).waitFor();assert.ok((await gallery.locator('#status').textContent()).includes('失败'));
 let downloads=await worker.evaluate(()=>chrome.downloads.search({}));assert.equal(downloads.filter(d=>d.state==='complete').length,2);
 for(const d of downloads){assert.ok(resolve(d.filename).startsWith(resolve(dir)));const n=Number(d.filename.match(/(\d{3})\.png$/)[1]);assert.deepEqual(await readFile(d.filename),images[n-1]);}
 await page.goto(base+'/elsewhere');fail=false;await gallery.bringToFront();await gallery.getByRole('button',{name:'重试未完成',exact:true}).click();await gallery.locator('#status').filter({hasText:'3 / 3 张'}).waitFor();
 downloads=await worker.evaluate(()=>chrome.downloads.search({}));assert.equal(downloads.length,3,'Retry does not duplicate completed downloads');assert.ok(downloads.every(d=>d.state==='complete'));
 await gallery.locator('.viewer').hover();await gallery.mouse.wheel(0,100);await gallery.locator('#counter').filter({hasText:'2 / 3'}).waitFor();await gallery.keyboard.press('ArrowRight');await gallery.locator('#counter').filter({hasText:'3 / 3'}).waitFor();assert.ok(await gallery.locator('#next').isDisabled());
 await gallery.locator('#preview-status').filter({hasText:'原图预览'}).waitFor();await gallery.screenshot({path:resolve('artifacts/v084-gallery-download.png')});
 await gallery.setViewportSize({width:390,height:844});assert.ok(await gallery.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await gallery.screenshot({path:resolve('artifacts/v084-gallery-mobile.png'),fullPage:true});await gallery.setViewportSize({width:1440,height:1000});
 await gallery.reload();await gallery.getByRole('button',{name:'全部已下载'}).waitFor();assert.equal((await worker.evaluate(()=>chrome.downloads.search({}))).length,3,'Reload retains completed progress');
 await page.bringToFront();await page.locator('#first').hover();await preview.getByText('1 / 3',{exact:true}).waitFor();slow=true;
 const another=context.waitForEvent('page');await preview.getByRole('button',{name:'批量下载 3 张',exact:true}).click();const cancelPage=await another;
 await cancelPage.locator('#status').filter({hasText:'正在下载 2 / 3'}).waitFor();await cancelPage.getByRole('button',{name:'停止下载',exact:true}).click();await cancelPage.locator('#status').filter({hasText:'已停止。已下载 1 / 3'}).waitFor();
 slow=false;await cancelPage.getByRole('button',{name:'重试未完成',exact:true}).click();await cancelPage.getByRole('button',{name:'全部已下载'}).waitFor();assert.equal((await worker.evaluate(()=>chrome.downloads.search({}))).length,6,'Cancellation resumes only remaining pages');
 assert.deepEqual(errors,[]);console.log('PASS: same-article grouping excludes recommendations; hover wheel and page arrows; numbered original downloads verified byte-for-byte; partial failure and retry without duplicates; download page survives source navigation');
}finally{await context.close();await new Promise(r=>source.close(r));}
