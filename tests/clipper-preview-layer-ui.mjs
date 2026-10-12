import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import sharp from 'sharp';
import assert from 'node:assert/strict';
const baseline=process.argv.includes('--baseline'),extension=resolve(process.env.LIVE_EXTENSION||'addons/browser/clipper');
const dir=await mkdtemp(resolve('artifacts/preview-layer-ui-'));
const image=await sharp({create:{width:1000,height:700,channels:3,background:'#468974'}}).png().toBuffer();
const server=createServer((req,res)=>{
 if(req.url.endsWith('.png')){res.writeHead(200,{'Content-Type':'image/png'});res.end(image);return;}
 res.writeHead(200,{'Content-Type':'text/html;charset=utf-8'});
 res.end(`<!doctype html><title>扩展预览层级验收</title><style>body{margin:24px;background:#e9f1ed;font:16px system-ui;min-height:2000px}article{width:220px}img{width:220px;height:154px}#obstruction{position:fixed;left:275px;right:0;top:0;bottom:0;z-index:2147483647;background:#b56955;pointer-events:none}dialog{width:90vw;height:85vh;background:#edf5f0}dialog article{margin:40px 0}#site-popover{position:fixed;inset:0 0 0 275px;margin:0;width:auto;height:auto;background:#b56955;border:0;pointer-events:none}#normal{display:block;margin:20px 0}</style><h1>扩展预览层级验收</h1><button id="normal" onclick="this.textContent='网页点击正常'">网页按钮</button><article id="work"><img id="source" src="/one.png"><img src="/two.png"></article><dialog id="site-dialog"><h2>网站原生弹窗</h2></dialog><div id="site-popover" popover="manual">网站原生浮层</div>`);
});server.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
let context;const result={extension,baseline,checks:[]};
try{
 for(const touch of baseline?[false]:[false,true]){
  context=await chromium.launchPersistentContext(join(dir,touch?'touch':'desktop'),{channel:'msedge',headless:true,hasTouch:touch,viewport:{width:1200,height:850},args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  context.setDefaultTimeout(10000);
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');await worker.evaluate(()=>chrome.storage.local.set({saveAction:'download'}));
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base);const host=page.locator('[data-znote-overlay]'),preview=host.locator('.preview'),counter=preview.locator('[aria-label="作品页码"]');
  await host.waitFor({state:'attached'});await page.locator('#source').hover();await counter.filter({hasText:'1 / 2'}).waitFor();
  const onTop=()=>preview.evaluate(el=>{const r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+Math.min(30,r.height/2);return document.elementFromPoint(x,y)===el.getRootNode().host;});
  await page.evaluate(()=>{const node=document.createElement('div');node.id='obstruction';node.style.pointerEvents='auto';document.documentElement.append(node)});
  if(baseline){assert.equal(await onTop(),false);await page.screenshot({path:join(dir,'baseline-covered.png')});result.reproduced=true;await context.close();context=null;break;}
  assert.ok(await onTop(),'Preview must cover later same-z-index page content');
  await page.evaluate(()=>document.getElementById('site-popover').showPopover());await page.waitForFunction(()=>document.querySelector('[data-znote-overlay]').matches(':popover-open'));
  await page.waitForTimeout(100);assert.ok(await onTop(),'Preview must cover later page popover');
  const click=locator=>touch?locator.tap():locator.click();
  await click(preview.getByRole('button',{name:'下一张',exact:true}));await counter.filter({hasText:'2 / 2'}).waitFor();await click(preview.getByRole('button',{name:'上一张',exact:true}));await counter.filter({hasText:'1 / 2'}).waitFor();
  await page.screenshot({path:join(dir,(touch?'touch':'desktop')+'-popover.png')});
  await page.keyboard.press('Escape');await preview.waitFor({state:'hidden'});await page.evaluate(()=>{document.getElementById('site-popover').hidePopover();document.getElementById('obstruction').remove()});
  await click(page.locator('#normal'));assert.equal(await page.locator('#normal').innerText(),'网页点击正常');
  await page.evaluate(()=>{const dialog=document.getElementById('site-dialog');dialog.append(document.getElementById('work'));dialog.showModal()});
  await page.locator('#source').hover();await counter.filter({hasText:'1 / 2'}).waitFor();assert.ok(await onTop(),'Preview must cover modal page dialog');
  assert.ok(await host.evaluate(el=>!!el.closest('dialog:modal')),'Preview actions must remain interactive inside native modal');
  await click(preview.getByRole('button',{name:'下一张',exact:true}));await counter.filter({hasText:'2 / 2'}).waitFor();
  await page.screenshot({path:join(dir,(touch?'touch':'desktop')+'-modal.png')});
  await preview.locator('input[type="range"]').focus();await page.keyboard.press('Escape');await preview.waitFor({state:'hidden'});assert.ok(await page.locator('#site-dialog').evaluate(el=>el.open),'Escape from a preview input should close only the extension preview');
  await page.evaluate(()=>{const dialog=document.getElementById('site-dialog');document.body.append(document.getElementById('work'));dialog.close()});
  await page.locator('#source').hover();await counter.filter({hasText:'1 / 2'}).waitFor();assert.ok(await onTop(),'Preview recovers after page dialog closes');await page.keyboard.press('Escape');
  await page.evaluate(()=>{const d=document.getElementById('site-dialog');d.append(document.getElementById('work'));d.showModal()});await page.locator('#source').hover();await counter.filter({hasText:'1 / 2'}).waitFor();
  await page.evaluate(()=>{document.body.append(document.getElementById('work'));document.getElementById('site-dialog').remove()});await page.waitForFunction(()=>document.querySelector('[data-znote-overlay]')?.isConnected);await page.keyboard.press('Escape');
  await click(page.locator('#normal'));await page.evaluate(()=>document.body.requestFullscreen());await page.locator('#source').hover();await counter.filter({hasText:'1 / 2'}).waitFor();assert.ok(await onTop(),'Preview must cover page fullscreen');await page.screenshot({path:join(dir,(touch?'touch':'desktop')+'-fullscreen.png')});await page.keyboard.press('Escape');assert.ok(await page.evaluate(()=>!!document.fullscreenElement));await page.evaluate(()=>document.exitFullscreen());
  await page.locator('#normal').hover();await page.mouse.wheel(0,250);await page.waitForFunction(()=>scrollY>0);assert.deepEqual(errors,[]);
  result.checks.push({touch,latePageElement:true,pagePopover:true,pageModal:true,pageFullscreen:true,removedModalRecovery:true,groupPaging:true,escapePreservesSite:true,siteClickAndScroll:true});await context.close();context=null;console.log('PASS '+(touch?'touch':'desktop'));
 }
}catch(e){result.error=e.message;throw e;}
finally{if(context)await context.close();await new Promise(r=>server.close(r));await writeFile(join(dir,'result.json'),JSON.stringify(result,null,2));console.log('Evidence: '+dir);}
