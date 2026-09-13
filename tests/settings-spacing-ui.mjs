import {chromium} from 'playwright';
import {mkdtemp} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {createApp} from '../server/app.js';
const dir=await mkdtemp(resolve('artifacts/settings-spacing-'));
const runtime=createApp({dataDir:dir,staticDir:resolve(process.env.UI_DIST||'dist')}),server=runtime.app.listen(0,'127.0.0.1');
await new Promise(r=>server.once('listening',r));
const base='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({channel:'msedge',headless:true}),context=await browser.newContext(),page=await context.newPage();
try{
 const response=await context.request.post(base+'/api/auth/setup',{data:{password:'0427'}});assert.ok(response.ok());
 await page.goto(base);await page.getByRole('button',{name:'设置与连接',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'设置与连接',exact:true});
 for(const width of [1366,390]){
   await page.setViewportSize({width,height:900});
   for(const theme of ['light','dark']){
     await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;document.documentElement.dataset.palette='slate'},theme);
     await page.waitForTimeout(250);
     const pixiv=dialog.locator('section').filter({has:page.getByRole('heading',{name:'Pixiv 增强版',exact:true})});
     await pixiv.scrollIntoViewIfNeeded();
     const gap=await pixiv.evaluate(el=>el.querySelector('h3').getBoundingClientRect().top-el.previousElementSibling.querySelector('.connection-actions').getBoundingClientRect().bottom);
     assert.ok(gap>=24,`Media sections gap ${gap}`);
     await page.screenshot({path:resolve(`artifacts/settings-media-${width}-${theme}.png`)});
     const client=dialog.locator('section').filter({has:page.getByRole('heading',{name:'客户端与反馈',exact:true})});
     await client.scrollIntoViewIfNeeded();
     const spacing=await client.evaluate(el=>el.querySelector('details').getBoundingClientRect().top-el.querySelector('.connection-actions').getBoundingClientRect().bottom);
     assert.ok(spacing>=16,`Client details gap ${spacing}`);
     await client.locator('summary').click();await page.screenshot({path:resolve(`artifacts/settings-client-${width}-${theme}.png`)});await client.locator('summary').click();
     assert.ok(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1));
   }
 }
 console.log('PASS Edge: settings section/action/details spacing; dark/light and 390px/1366px; no horizontal overflow');
}finally{await browser.close();await runtime.weixin.stop();await runtime.trash.stop();await runtime.imports.stop();await runtime.backups.stop();await runtime.webhooks.stop();await new Promise(r=>server.close(r));runtime.db.close()}
