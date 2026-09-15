import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createApp} from '../server/app.js';
const dir=await mkdtemp(resolve('artifacts/organize-ui-')),runtime=createApp({dataDir:dir,staticDir:resolve('dist')}),server=runtime.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const browser=await chromium.launch({channel:'msedge',headless:true}),context=await browser.newContext({viewport:{width:1280,height:900},hasTouch:true}),page=await context.newPage(),base='http://127.0.0.1:'+server.address().port;
page.setDefaultTimeout(10000);
try{
 await context.request.post(base+'/api/auth/setup',{data:{password:'0916'}});await context.request.patch(base+'/api/preferences',{data:{default_collection_id:'unfiled'}});
 await context.request.post(base+'/api/items',{data:{title:'整理测试',content:'正文'}});
 await page.goto(base);await page.getByRole('button',{name:'选择内容',exact:true}).click();await page.locator('.card-main').click();
 await page.getByRole('button',{name:'移动 / 收藏',exact:true}).click();
 const dialog=page.locator('.organize-dialog');await dialog.waitFor();
 await page.evaluate(()=>{document.documentElement.dataset.theme='dark';document.documentElement.dataset.palette='slate';});await page.waitForTimeout(400);
 assert.ok(await dialog.getByLabel('整理目标知识库').isDisabled());await dialog.getByText('移动到知识库',{exact:true}).click();assert.ok(await dialog.getByLabel('整理目标知识库').isEnabled());
 const aligned=await dialog.locator('.organize-toggle').evaluate(e=>{const a=e.querySelector('input').getBoundingClientRect(),b=e.querySelector('span').getBoundingClientRect();return Math.abs((a.top+a.bottom-b.top-b.bottom)/2)<2;});assert.ok(aligned);
 await dialog.screenshot({path:resolve(dir,'desktop.png')});
 await page.setViewportSize({width:390,height:844});await dialog.screenshot({path:resolve(dir,'mobile.png')});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.route('**/api/items/batch-organize',r=>r.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'测试保存失败'})}));
 await dialog.getByRole('button',{name:'确认整理',exact:true}).tap();await dialog.getByRole('alert').waitFor();assert.ok(await dialog.getByRole('button',{name:'确认整理',exact:true}).isEnabled());await page.unrouteAll();
 await dialog.getByLabel('批量收藏状态').selectOption('yes');await dialog.getByRole('button',{name:'确认整理',exact:true}).tap();await dialog.waitFor({state:'detached'});
 assert.equal(runtime.db.prepare('SELECT favorite FROM items').get().favorite,1);console.log('PASS organized dialog alignment, touch, failure/retry and save; '+dir);
}finally{await browser.close();for(const key of ['captures','weixin','trash','imports','backups','webhooks'])await runtime[key].stop();await new Promise(r=>server.close(r));runtime.db.close();}
