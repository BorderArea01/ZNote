import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {mkdtemp,writeFile,mkdir,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import assert from 'node:assert/strict';
import sharp from 'sharp';
const dir=await mkdtemp(resolve('artifacts/hover-wheel-')),extension=resolve('extensions/clipper');
const images=await Promise.all(['#508d77','#a67b63','#827ab0'].map(background=>sharp({create:{width:1200,height:800,channels:3,background}}).png().toBuffer()));
let delayed=false;
const server=createServer((req,res)=>{
 const match=req.url.match(/^\/p([123])\.png/);
 if(match){res.setHeader('Content-Type','image/png');if(delayed&&match[1]==='2'){setTimeout(()=>res.end(images[1]),1200);return;}res.end(images[Number(match[1])-1]);return;}
 res.setHeader('Content-Type','text/html;charset=utf-8');res.end('<!doctype html><title>滚轮翻页验证</title><style>body{margin:40px;font:18px system-ui;background:#eef5f1;min-height:2200px}article{width:260px}img{width:260px;height:174px}#outside{position:absolute;top:200px;right:30px;width:240px;height:300px;background:#ddd}input{width:180px}</style><h1>保留鼠标位置，滚轮连续翻页</h1><article><img id="source" src="/p1.png"><img src="/p2.png"><img src="/p3.png"></article><div id="outside">正常页面滚动区域</div>');
});server.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
await mkdir(join(dir,'profile','Default'),{recursive:true});await mkdir(join(dir,'downloads'));
await writeFile(join(dir,'profile','Default','Preferences'),JSON.stringify({download:{default_directory:join(dir,'downloads'),prompt_for_download:false}}));
const context=await chromium.launchPersistentContext(join(dir,'profile'),{channel:'msedge',headless:true,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`],viewport:{width:1440,height:1000}});
const page=await context.newPage(),worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker'),cdp=await context.newCDPSession(page);
await cdp.send('Browser.setDownloadBehavior',{behavior:'default'});const errors=[];page.on('pageerror',e=>errors.push(e.message));
const preview=page.locator('[data-znote-overlay]').locator('.preview');
const counter=()=>preview.locator('[aria-label="作品页码"]');
try{
 await page.goto(base);await page.locator('[data-znote-overlay]').waitFor({state:'attached'});await page.locator('#source').hover();await counter().filter({hasText:'1 / 3'}).waitFor();
 // Keep the mouse on the website thumbnail: do not hover any extension button.
 await page.mouse.wheel(0,100);await counter().filter({hasText:'2 / 3'}).waitFor({timeout:5000});assert.equal(await page.evaluate(()=>scrollY),0);
 await page.waitForTimeout(250);await page.mouse.wheel(0,-100);await counter().filter({hasText:'1 / 3'}).waitFor();
 // The center of the expanded image must work too, and must not scroll the page.
 const box=await preview.locator('img').boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.waitForTimeout(250);await page.mouse.wheel(0,100);await counter().filter({hasText:'2 / 3'}).waitFor();assert.equal(await page.evaluate(()=>scrollY),0);
 // Multiple input steps while the next original is loading must not be dropped.
 await page.keyboard.press('Escape');delayed=true;await page.goto(base+'/slow');await page.locator('#source').hover();await counter().filter({hasText:'1 / 3'}).waitFor();
 await page.mouse.wheel(0,100);await page.waitForTimeout(260);await page.mouse.wheel(0,100);
 await counter().filter({hasText:'3 / 3'}).waitFor({timeout:5000});await page.waitForFunction(()=>document.querySelector('[data-znote-overlay]').shadowRoot.querySelector('.preview img').getAttribute('src').endsWith('/p3.png'));
 assert.equal(await page.evaluate(()=>scrollY),0);
 await page.screenshot({path:resolve('artifacts/v085-source-wheel.png')});
 await page.keyboard.press('s');await preview.getByText('已交给浏览器下载',{exact:true}).waitFor();
 let downloads=[];for(let n=0;n<50;n++){downloads=await worker.evaluate(()=>chrome.downloads.search({}));if(downloads.some(d=>d.state==='complete'))break;await page.waitForTimeout(100);}
 const download=downloads.find(d=>d.state==='complete');assert.ok(download);assert.ok(download.url.endsWith('/p3.png'));assert.deepEqual(await readFile(download.filename),images[2]);
 await page.locator('#outside').hover();await page.mouse.wheel(0,300);await page.waitForFunction(()=>scrollY>0);await preview.waitFor({state:'hidden'});
 assert.deepEqual(errors,[]);console.log('PASS: thumbnail and expanded image center wheel navigation; slow original input retained; current-page download bytes; outside wheel restores normal page scrolling');
}finally{await context.close();await new Promise(r=>server.close(r));}
