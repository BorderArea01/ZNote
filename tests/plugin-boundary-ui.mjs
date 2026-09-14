import {chromium} from 'playwright';
import {mkdtemp} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {createApp} from '../server/app.js';
const runtime=createApp({dataDir:await mkdtemp(resolve('artifacts/plugin-ui-')),staticDir:resolve('dist')}),server=runtime.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({channel:'msedge',headless:true}),context=await browser.newContext({viewport:{width:1280,height:900},hasTouch:true}),page=await context.newPage();
try{
 await context.request.post(base+'/api/auth/setup',{data:{password:'0059'}});await page.goto(base);await page.getByRole('button',{name:'设置与连接',exact:true}).click();
 await page.getByRole('heading',{name:'其他插件',exact:true}).scrollIntoViewIfNeeded();assert.equal(await page.locator('a[href*="/api/clipper/pixiv"],a[href*="ehentai"]').count(),0);
 const hint=page.getByRole('button',{name:'其他插件接入说明',exact:true});await hint.hover();await page.getByRole('tooltip').waitFor();await page.screenshot({path:resolve('artifacts/plugin-settings-desktop.png')});await page.keyboard.press('Escape');
 await page.setViewportSize({width:390,height:844});await hint.tap();await page.waitForTimeout(250);assert.equal(await hint.getAttribute('aria-expanded'),'true');assert.ok(await page.getByRole('tooltip').evaluate(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth}));await page.screenshot({path:resolve('artifacts/plugin-settings-mobile.png')});await hint.tap();await page.getByRole('tooltip').waitFor({state:'hidden'});
 assert.equal(await page.getByRole('link',{name:'API 接入文档',exact:true}).getAttribute('href'),'/api/docs');console.log('PASS generic plugin UI, no private links, mouse/touch hint and dismissal');
}finally{await browser.close();await runtime.imports.stop();await runtime.backups.stop();await runtime.webhooks.stop();await new Promise(r=>server.close(r));runtime.db.close()}
