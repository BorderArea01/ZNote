import { chromium } from 'playwright';
import { mkdtemp } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { createApp } from '../server/app.js';

const dir=await mkdtemp(resolve('artifacts/region-ui-')),extension=resolve('addons/browser/clipper');
const runtime=createApp({dataDir:dir}),server=runtime.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
const fixture=createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><html style="background:#123456"><body style="margin:0;height:100vh"><div style="position:fixed;inset:0;background:#123456"></div></body></html>');});fixture.listen(0,'127.0.0.1');await new Promise(r=>fixture.once('listening',r));const source='http://127.0.0.1:'+fixture.address().port;
let context;
try {
  for(const touch of [false,true]) {
    context=await chromium.launchPersistentContext(join(dir,touch?'touch':'desktop'),{channel:'msedge',headless:true,hasTouch:touch,viewport:{width:800,height:600},deviceScaleFactor:touch?2:1,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
    const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
    await context.request.post(base+'/api/auth/setup',{data:{password:'0123'}});
    if(touch)await context.request.post(base+'/api/auth/login',{data:{password:'0123'}});
    const token=await (await context.request.post(base+'/api/tokens',{data:{name:'region-test',scope:'write'}})).json();
    await worker.evaluate(config=>chrome.storage.local.set(config),{server:base,token:token.token});
    const popup=await context.newPage();await popup.goto('chrome-extension://'+new URL(worker.url()).host+'/popup.html');
    const page=await context.newPage();await page.goto(source);await page.bringToFront();
    await page.waitForTimeout(300);
    const fullSize=await sharp(Buffer.from((await worker.evaluate(()=>chrome.tabs.captureVisibleTab(undefined,{format:'png'}))).split(',')[1],'base64')).metadata();
    const tabId=await worker.evaluate(async source=>(await chrome.tabs.query({url:source+'/*'}))[0].id,source);
    const start=()=>popup.evaluate(tabId=>{globalThis.regionResult=null;chrome.runtime.sendMessage({type:'capture-region',tabId}).then(result=>globalThis.regionResult=result,error=>globalThis.regionResult={error:error.message});},tabId);
    await start();const overlay=page.locator('#znote-region-capture');await overlay.waitFor();
    if(touch)await overlay.getByRole('button',{name:'取消',exact:true}).tap();else await page.keyboard.press('Escape');await overlay.waitFor({state:'hidden'});
    await popup.waitForFunction(()=>globalThis.regionResult?.item?.cancelled===true);
    await start();await overlay.waitFor();
    await page.mouse.move(20,200);await page.mouse.down();await page.mouse.move(23,203);await page.mouse.up();assert.equal(await overlay.getByRole('button',{name:'保存截图'}).isDisabled(),true);
    if(touch){const cdp=await context.newCDPSession(page);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:350,y:450}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:100,y:250}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();}
    else {await page.mouse.move(100,250);await page.mouse.down();await page.mouse.move(350,450);await page.mouse.up();}
    const hint=overlay.getByRole('button',{name:'框选截图说明'});
    if(touch){await hint.tap();await page.waitForTimeout(150);assert.equal(await hint.getAttribute('aria-expanded'),'true');await hint.tap();}
    else {await hint.hover();assert.equal(await hint.getAttribute('aria-expanded'),'true');await page.mouse.move(600,250);assert.equal(await hint.getAttribute('aria-expanded'),'false');await hint.focus();await page.keyboard.press('Enter');await page.mouse.move(600,250);assert.equal(await hint.getAttribute('aria-expanded'),'true');await page.keyboard.press('Enter');}
    assert.equal(await hint.getAttribute('aria-expanded'),'false',`help closes after ${touch?'touch':'keyboard'} toggle`);
    await page.screenshot({path:resolve(`artifacts/region-${touch?'touch':'desktop'}.png`)});
    if(touch)await overlay.getByRole('button',{name:'保存截图'}).tap();else {await overlay.getByRole('button',{name:'保存截图'}).focus();await page.keyboard.press('Enter');}
    await overlay.waitFor({state:'hidden'});await popup.waitForFunction(()=>globalThis.regionResult!==null);const result=await popup.evaluate(()=>globalThis.regionResult);assert.ok(result.item?.id,JSON.stringify(result));
    const item=await (await context.request.get(base+'/api/items/'+result.item.id)).json();assert.equal(item.width,Math.round(250*fullSize.width/800));assert.equal(item.height,Math.round(200*fullSize.height/600));assert.equal(item.source_url,source+'/');assert.match(item.content,/手动框选/);
    const double=await popup.evaluate(async()=>{const {cropScreenshot}=await import(chrome.runtime.getURL('actions.js'));const canvas=new OffscreenCanvas(1600,1200);canvas.getContext('2d').fillRect(0,0,1600,1200);const cropped=await cropScreenshot(await canvas.convertToBlob(),{x:100,y:250,width:250,height:200,viewportWidth:800,viewportHeight:600});const b=await createImageBitmap(cropped);const result=[b.width,b.height];b.close();return result;});assert.deepEqual(double,[500,400]);
    const bytes=Buffer.from(await (await context.request.get(base+item.url)).body());const pixel=await sharp(bytes).raw().toBuffer();assert.deepEqual([...pixel.subarray(0,3)],[18,52,86],'selection dimmer and controls must not appear in saved screenshot');
    await page.getByRole('status').filter({hasText:'区域截图已保存'}).waitFor();
    await page.waitForTimeout(1100); // Respect Chrome's captureVisibleTab rate limit.
    await worker.evaluate(()=>chrome.storage.local.set({token:''}));await start();await overlay.waitFor();await page.mouse.move(100,250);await page.mouse.down();await page.mouse.move(350,450);await page.mouse.up();if(touch)await overlay.getByRole('button',{name:'保存截图'}).tap();else await overlay.getByRole('button',{name:'保存截图'}).click();await popup.waitForFunction(()=>globalThis.regionResult!==null);assert.match((await popup.evaluate(()=>globalThis.regionResult)).error,/令牌/);await page.getByRole('status').filter({hasText:'令牌'}).waitFor();
    await worker.evaluate(token=>chrome.storage.local.set({token}),token.token);await start();await overlay.waitFor();if(touch)await overlay.getByRole('button',{name:'取消',exact:true}).tap();else await overlay.getByRole('button',{name:'取消',exact:true}).click();await overlay.waitFor({state:'hidden'});
    await context.close();context=null;
  }
  console.log('PASS actual extension region screenshots: mouse/touch, reverse drag, 1x/2x pixels, correct crop and clean pixels, cancel/Enter, tiny area, source/remarks, upload failure feedback and retry entry');
} finally {await context?.close();await runtime.captures.stop();await runtime.imports.stop();await runtime.trash.stop();await runtime.backups.stop();await runtime.webhooks.stop();await new Promise(r=>server.close(r));await new Promise(r=>fixture.close(r));runtime.db.close();}
