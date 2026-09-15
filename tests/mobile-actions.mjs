import {chromium} from 'playwright';
import {createApp} from '../server/app.js';
import {mkdtemp} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const dataDir=await mkdtemp(resolve('artifacts/mobile-actions-'));
const {app,db}=createApp({dataDir,staticDir:resolve('dist')});
const server=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s));});
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
const context=await browser.newContext({viewport:{width:1440,height:950}}),page=await context.newPage();
await page.goto(`http://127.0.0.1:${server.address().port}`);await page.getByLabel('访问密码').fill('0427');await page.getByRole('button',{name:'开始使用 ZNote'}).click();
await page.getByRole('heading',{name:/我的知识库/}).waitFor();assert(await page.getByRole('button',{name:'上传图片',exact:true}).isVisible());assert(!(await page.getByRole('button',{name:'添加',exact:true}).isVisible()));
const mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,storageState:await context.storageState()}),p=await mobile.newPage();await p.goto(`http://127.0.0.1:${server.address().port}`);
await p.getByRole('button',{name:'添加',exact:true}).waitFor();assert(!(await p.getByRole('button',{name:'上传图片',exact:true}).isVisible()));
await p.screenshot({path:'artifacts/mobile-home.png'});await p.getByRole('button',{name:'添加',exact:true}).tap();const modal=p.getByRole('dialog');await modal.waitFor();assert.equal(await modal.getByRole('button').count(),6);await p.screenshot({path:'artifacts/mobile-actions.png'});
assert(await p.evaluate(()=>window.ZNoteNavigation.back()));await modal.waitFor({state:'hidden'});
await p.getByRole('button',{name:'添加',exact:true}).tap();await p.keyboard.press('Escape');await modal.waitFor({state:'hidden'});
await p.getByRole('button',{name:'添加',exact:true}).tap();await modal.getByRole('button',{name:'上传图片',exact:true}).tap();await p.getByRole('heading',{name:'批量上传图片'}).waitFor();
await p.getByRole('button',{name:'关闭窗口',exact:true}).tap();assert.equal(await p.getByRole('dialog').count(),0);
console.log('PASS desktop actions, mobile touch menu, Android back, Escape and upload flow');
}finally{await browser.close();server.close();db.close();}
