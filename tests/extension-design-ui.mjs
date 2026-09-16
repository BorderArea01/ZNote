import {chromium} from 'playwright';
import {mkdtemp} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const dir=await mkdtemp(resolve('artifacts/extension-design-'));
const extension=resolve('addons/browser/clipper');
const context=await chromium.launchPersistentContext(dir,{channel:'msedge',headless:true,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`],viewport:{width:1100,height:1100},colorScheme:'light'});
try{
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
 const origin='chrome-extension://'+new URL(worker.url()).host;
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'/popup.html');await page.locator('#shortcut-help').filter({hasText:'Z 入库'}).waitFor();
 assert.equal(await page.locator('.tools button').count(),4);
 await page.locator('body').screenshot({path:resolve('artifacts/v091-extension-popup.png')});
 await page.locator('#settings').click();
 const options=context.pages().find(p=>p.url().includes('options.html'))||await context.waitForEvent('page');
 await options.waitForURL('**/options.html');
 await options.locator('#save-key').waitFor();
 const dark=await options.evaluate(()=>getComputedStyle(document.documentElement).colorScheme);assert.equal(dark,'dark');
 await options.screenshot({path:resolve('artifacts/v091-extension-options.png'),fullPage:true});
 await options.setViewportSize({width:390,height:844});
 assert.ok(await options.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile options must fit');
 await options.screenshot({path:resolve('artifacts/v091-extension-options-mobile.png'),fullPage:true});
 assert.deepEqual(errors,[]);console.log('PASS: real extension popup/settings, dark theme even on light OS, icons/buttons, mobile layout');
}finally{await context.close();}
