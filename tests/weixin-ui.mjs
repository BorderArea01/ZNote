import {chromium} from 'playwright';
import {mkdtemp} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {createApp} from '../server/app.js';
const dir=await mkdtemp(resolve('artifacts/weixin-ui-'));let authorized=false,checks=0,messages=[];
const image=await sharp({create:{width:32,height:24,channels:3,background:'#6688dd'}}).png().toBuffer();
const abortable=signal=>new Promise((resolve,reject)=>{if(signal?.aborted)return reject(signal.reason);signal?.addEventListener('abort',()=>reject(signal.reason),{once:true});});
const client={qr:async()=>({qrcode:'fixture',qrcode_img_content:'https://example.com/fixture-qr'}),qrStatus:async(_,opts)=>{checks++;if(!authorized)return {status:'need_verifycode'};return {status:'confirmed',bot_token:'secret',ilink_bot_id:'bot',ilink_user_id:'owner',baseurl:'https://ilinkai.weixin.qq.com'}},updates:async(_,cursor,signal)=>messages.length?{msgs:messages.splice(0),get_updates_buf:'cursor'}:abortable(signal),image:async()=>image};
const runtime=createApp({dataDir:dir,staticDir:resolve('artifacts/build-v0929'),weixinClient:client}),server=runtime.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({channel:'msedge',headless:true}),context=await browser.newContext({viewport:{width:1366,height:900}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
await context.request.post(base+'/api/auth/setup',{data:{password:'0929'}});const library=await(await context.request.post(base+'/api/collections',{data:{name:'微信灵感'}})).json();
await page.goto(base);await page.getByRole('button',{name:'设置与连接',exact:true}).click();const section=page.locator('.weixin-settings');await section.getByRole('button',{name:'扫码连接微信',exact:true}).waitFor();await section.getByLabel('微信默认知识库').selectOption(library.id);await section.getByLabel('微信入库标签').fill('灵感,手绘');await section.getByRole('button',{name:'扫码连接微信',exact:true}).click();await section.getByAltText('使用微信扫码连接 ZNote').waitFor();await section.getByLabel('微信验证码').waitFor();assert.equal(checks,1,'No repeated verification calls without user code');
await page.screenshot({path:resolve('artifacts/v0929-weixin-desktop.png'),fullPage:true});
authorized=true;messages=[{message_type:1,message_state:2,message_id:1,from_user_id:'owner',item_list:[{type:1,text_item:{text:'**微信灵感** [参考](https://example.com/)'}},{type:2,image_item:{media:{}}}]}];await section.getByLabel('微信验证码').fill('123456');await section.getByRole('button',{name:'提交验证码',exact:true}).click();await section.getByRole('button',{name:'暂停接收',exact:true}).waitFor();await page.waitForFunction(async()=>{const s=await(await fetch('/api/weixin')).json();return s.jobs.some(j=>j.state==='done')});
await section.getByText(/最近收件/).click();await section.getByText('已入库',{exact:true}).waitFor();const rows=runtime.db.prepare('SELECT * FROM items').all();assert.equal(rows.length,2);assert.ok(rows.every(r=>r.collection_id===library.id));
await section.getByRole('button',{name:'暂停接收',exact:true}).click();await section.getByRole('button',{name:'恢复接收',exact:true}).waitFor();
await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await section.scrollIntoViewIfNeeded();await page.screenshot({path:resolve('artifacts/v0929-weixin-mobile.png'),fullPage:true});
await section.getByRole('button',{name:'断开连接',exact:true}).click();await section.getByRole('button',{name:'扫码连接微信',exact:true}).waitFor();assert.equal(runtime.weixin.status().connected,false);assert.equal(runtime.db.prepare('SELECT count(*) n FROM items').get().n,2);assert.deepEqual(errors,[]);console.log('PASS: Edge settings QR/verification, bound sender text + local image ingest, pinned library/tags, pause/disconnect, mobile layout; no external WeChat account used');
}finally{await runtime.weixin.stop();await browser.close();await runtime.trash.stop();await runtime.imports.stop();await runtime.backups.stop();await runtime.webhooks.stop();await new Promise(r=>server.close(r));runtime.db.close()}
