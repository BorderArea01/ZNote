import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createApp} from '../server/app.js';
const dir=await mkdtemp(resolve('artifacts/sort-control-')),runtime=createApp({dataDir:dir,staticDir:resolve('dist')}),server=runtime.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const base='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({channel:'msedge',headless:true}),context=await browser.newContext({viewport:{width:1280,height:900},hasTouch:true}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(12000);
try{
 await context.request.post(base+'/api/auth/setup',{data:{password:'0916'}});await context.request.patch(base+'/api/preferences',{data:{default_collection_id:'unfiled'}});
 const add=(kind,title,key=null)=>{const id=randomUUID();runtime.db.prepare('INSERT INTO items(id,kind,title,content,group_key,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(id,kind,title,'',key,'2026-01-01','2026-01-01');return id;};
 const orphan=add('image','孤立单张','legacy:one'),group=add('image','组合甲','test:group');add('image','组合乙','test:group');add('note','笔记');const video=add('video','视频');
 await page.goto(base);await page.locator('.sidebar').getByRole('button',{name:/^未分类/}).click();await page.locator('.item-card').nth(3).waitFor();
 await page.locator('.sort-trigger').click();await page.getByRole('checkbox',{name:'按类型分区',exact:true}).check();await page.waitForFunction(id=>document.querySelector('.item-card')?.dataset.itemId===id,orphan);
 await page.screenshot({path:resolve(dir,'desktop-sort.png')});
 await page.setViewportSize({width:390,height:844});
 for(let i=0;i<3;i++)await page.getByRole('button',{name:'视频上移',exact:true}).tap();
 await page.waitForFunction(id=>document.querySelector('.item-card')?.dataset.itemId===id,video);
 assert.ok(await page.getByRole('button',{name:'视频上移',exact:true}).isDisabled());
 await page.getByRole('button',{name:'排序说明',exact:true}).tap();await page.getByRole('tooltip').waitFor();assert.ok(await page.getByRole('tooltip').isVisible());await page.getByRole('button',{name:'排序说明',exact:true}).tap();
 await page.evaluate(()=>{document.documentElement.dataset.theme='dark';document.documentElement.dataset.palette='slate';});await page.waitForTimeout(400);await page.screenshot({path:resolve(dir,'mobile-sort.png')});await page.getByRole('button',{name:'完成',exact:true}).tap();
 await page.reload();await page.waitForFunction(id=>document.querySelector('.item-card')?.dataset.itemId===id,video);
 await page.locator('.sort-trigger').tap();assert.equal(await page.locator('.type-order li').first().innerText().then(s=>s.includes('视频')),true);
 await page.keyboard.press('Escape');await page.locator('.sort-dialog').waitFor({state:'detached'});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);
 console.log('PASS unfiled classification, custom type order, mobile hints, dismissal, persistence; '+dir);
}finally{await browser.close();for(const key of ['captures','weixin','trash','imports','backups','webhooks'])await runtime[key].stop();await new Promise(r=>server.close(r));runtime.db.close();}
