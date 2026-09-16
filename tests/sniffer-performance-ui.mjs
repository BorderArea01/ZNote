import {chromium} from 'playwright';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import assert from 'node:assert/strict';
const extension=resolve(process.env.PERF_EXTENSION||'addons/browser/clipper'),dir=await mkdtemp(resolve('artifacts/sniffer-perf-'));
const context=await chromium.launchPersistentContext(join(dir,'profile'),{channel:'msedge',headless:true,args:['--mute-audio','--disable-extensions-except='+extension,'--load-extension='+extension]}),worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker'),page=await context.newPage();
const bytes=await readFile('tests/fixtures/sample.mp4');let mediaRequests=0;
try{
 await worker.evaluate(()=>{globalThis.perfScans=0;chrome.runtime.onMessage.addListener(m=>{if(m.type==='media-scan')globalThis.perfScans++})});
 await context.route('https://**/*',r=>{if(r.request().url().includes('cdn.test')){mediaRequests++;return r.fulfill({contentType:'video/mp4',headers:{'Access-Control-Allow-Origin':'*'},body:bytes})}return r.fulfill({contentType:'text/html',body:'<!doctype html><title>Performance fixture</title><video muted></video>'})});
 await page.goto('https://www.douyin.com/user/self');
 const ui=page.locator('[data-znote-overlay]');await ui.getByRole('button',{name:'ZNote 视频嗅探',exact:true}).click();
 await page.evaluate(async()=>{await Promise.all(Array.from({length:24},(_,i)=>fetch('https://cdn.test/'+i+'.mp4').then(r=>r.arrayBuffer())))});
 await ui.getByRole('button',{name:'扫描',exact:true}).click();await ui.locator('.item').first().waitFor();
 const session=await context.newCDPSession(page);await session.send('Performance.enable');
 await page.mouse.move(5,5);
 await page.waitForTimeout(2000);
 const sample=async()=>({time:Date.now(),requests:mediaRequests,scans:await worker.evaluate(()=>globalThis.perfScans),metrics:Object.fromEntries((await session.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]))});
 const before=await sample();await page.waitForTimeout(8000);const after=await sample();
 const report={extension,seconds:(after.time-before.time)/1000,idleMediaRequests:after.requests-before.requests,idleScans:after.scans-before.scans,mainThreadSeconds:after.metrics.TaskDuration-before.metrics.TaskDuration,heapMB:after.metrics.JSHeapUsedSize/1024/1024,cards:await ui.locator('.item').count()};
 await writeFile('artifacts/'+(process.env.PERF_BASELINE?'v0912':'v0913')+'-sniffer-performance.json',JSON.stringify(report,null,2));console.log(report);
 if(!process.env.PERF_BASELINE){assert.equal(report.idleMediaRequests,0,'idle list must not reload/decode video resources');assert.ok(report.idleScans<=1,'idle list must settle');assert.equal(report.cards,24);
  const first=ui.locator('.item').first();const node=await first.elementHandle();await ui.getByRole('button',{name:'扫描',exact:true}).click();await page.waitForTimeout(500);assert.ok(await node.evaluate(el=>el.isConnected),'unchanged scans retain card DOM');
  await first.locator('.thumb-button').hover();await first.locator('img[alt="视频首帧"]').waitFor({timeout:6000});
  const framedRequests=mediaRequests;await page.mouse.move(5,5);await first.locator('.thumb-button').hover();await page.waitForTimeout(1000);assert.equal(mediaRequests,framedRequests,'cached first frame must not reload the video');
  await ui.getByRole('button',{name:'收起',exact:true}).click();const closed=await sample();await page.waitForTimeout(2500);const closedAfter=await sample();assert.equal(closedAfter.requests,closed.requests);assert.equal(closedAfter.scans,closed.scans);
 }
}finally{await context.close()}
