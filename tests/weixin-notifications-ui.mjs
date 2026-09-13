import {chromium} from 'playwright';
import {mkdtemp} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {createApp} from '../server/app.js';

const dir=await mkdtemp(resolve('artifacts/weixin-notify-ui-'));
let calls=0,mode='accept';
const client={updates:async()=>({msgs:[]}),sendText:async()=>{calls++;if(mode==='reject')throw Object.assign(Error('do not expose this'),{weixinCode:-2});return {accepted:true}}};
const runtime=createApp({dataDir:dir,weixinClient:client}),server=runtime.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const base='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({channel:'msedge',headless:true}),context=await browser.newContext({viewport:{width:1366,height:1000}}),page=await context.newPage(),errors=[];
page.on('pageerror',e=>errors.push(e.message));
const a={base:'https://ilinkai.weixin.qq.com',token:'fake-token',user:'fake-owner',bot:'fake-bot'};
runtime.db.prepare("INSERT INTO settings(key,value) VALUES('weixin_inbox_v1',?)").run(JSON.stringify({enabled:false,account:a,cursor:'preserved',jobs:[],tags:['微信'],collection_id:null}));
try{
 await context.request.post(base+'/api/auth/setup',{data:{password:'test-password'}});
 await page.goto(base);await page.getByRole('button',{name:'设置与连接',exact:true}).click();
 const panel=page.getByRole('region',{name:'微信通知发送'}),enable=panel.getByRole('checkbox'),send=panel.getByRole('button',{name:'发送测试通知'});
 await enable.waitFor();assert.equal(await enable.isChecked(),false);assert.equal(await send.isDisabled(),true);
 await enable.check();await panel.getByText(/需要绑定用户先向/).waitFor();assert.equal(await send.isDisabled(),true);assert.equal(calls,0);
 runtime.weixinNotifications.captureContext({from_user_id:a.user,message_type:1,message_state:2,context_token:'fake-context'},a);
 await page.waitForFunction(()=>!document.querySelector('.weixin-notifications button')?.disabled);
 page.once('dialog',dialog=>dialog.dismiss());await send.click();assert.equal(calls,0,'Cancel does not send');
 page.once('dialog',dialog=>dialog.accept());await send.click();await panel.getByRole('status').waitFor();assert.equal(calls,1);
 await panel.getByText(/最近发送记录/).click();await panel.getByText('微信已接受',{exact:true}).waitFor();
 await page.screenshot({path:resolve('artifacts/weixin-notification-desktop.png'),fullPage:true});
 await page.waitForTimeout(3100);mode='reject';page.once('dialog',dialog=>dialog.accept());await send.click();await panel.getByRole('alert').waitFor();await panel.getByText('微信拒绝',{exact:true}).waitFor();assert.equal(calls,2);
 assert.ok(!(await panel.textContent()).includes('do not expose this'));
 await page.setViewportSize({width:390,height:844});await panel.scrollIntoViewIfNeeded();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.screenshot({path:resolve('artifacts/weixin-notification-mobile.png'),fullPage:true});
 const state=JSON.parse(runtime.db.prepare("SELECT value FROM settings WHERE key='weixin_inbox_v1'").get().value);assert.equal(state.enabled,false);assert.equal(state.cursor,'preserved');assert.equal(runtime.db.prepare('SELECT count(*) n FROM items').get().n,0);assert.deepEqual(errors,[]);
 console.log('PASS: notification opt-in, context readiness, cancel/confirm, honest rejection, desktop/mobile, no inbox or note mutation; mock channel only.');
}finally{await browser.close();await runtime.weixin.stop();await runtime.trash.stop();await runtime.imports.stop();await runtime.backups.stop();await runtime.webhooks.stop();await new Promise(r=>server.close(r));runtime.db.close()}
