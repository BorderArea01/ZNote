// Real action-popup acceptance, including Chromium's intrinsic auto sizing.
// A normal tab with a preset viewport cannot reproduce the collapsed popup.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
if(!process.argv.includes('--live'))throw Error('Pass --live to check the running ZNote server');
const base='http://127.0.0.1:3741',extension=resolve(process.env.ZNOTE_CLIPPER_DIR||'addons/browser/clipper');
const dir=await mkdtemp(resolve('artifacts/popup-layout-')),db=new DatabaseSync('data/znote.sqlite');
const tokenId=randomUUID(),token='zn_'+randomBytes(32).toString('hex');
const pin=()=>db.prepare("SELECT value FROM settings WHERE key='password'").get()?.value,pinBefore=pin();
db.prepare('INSERT INTO tokens(id,name,hash,scope,kind,created_at,expires_at) VALUES(?,?,?,?,?,?,?)').run(tokenId,'临时扩展弹窗尺寸验收',createHash('sha256').update(token).digest('hex'),'write','api',new Date().toISOString(),new Date(Date.now()+600000).toISOString());
let context;const result={extension,ui:[]};
try{
 const health=await fetch(base+'/api/health');assert.ok(health.ok);result.health=await health.json();
 for(const touch of [false,true]){
  const label=touch?'touch':'desktop';
  context=await chromium.launchPersistentContext(join(dir,label),{channel:'msedge',headless:true,hasTouch:touch,viewport:{width:1200,height:900},args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`,'--disable-gpu','--renderer-process-limit=2']});
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  await worker.evaluate(config=>chrome.storage.local.set(config),{server:base,token,saveAction:'save'});
  const page=context.pages()[0];await page.goto(base);const cdp=await context.newCDPSession(page);
  async function open(){
   await page.bringToFront();await worker.evaluate(()=>chrome.action.openPopup());let target;
   for(let i=0;i<50&&!target;i++){target=(await cdp.send('Target.getTargets')).targetInfos.find(t=>t.url===new URL('popup.html',worker.url()).href);if(!target)await new Promise(r=>setTimeout(r,50));}assert.ok(target,'native popup target');
   const {sessionId}=await cdp.send('Target.attachToTarget',{targetId:target.targetId,flatten:false});let seq=0;const pending=new Map();
   const listener=event=>{if(event.sessionId!==sessionId)return;const reply=JSON.parse(event.message),p=pending.get(reply.id);if(!p)return;pending.delete(reply.id);clearTimeout(p.timer);reply.error?p.reject(Error(reply.error.message)):p.resolve(reply.result);};
   cdp.on('Target.receivedMessageFromTarget',listener);
   const send=async(method,params={})=>{const id=++seq;const response=new Promise((resolve,reject)=>pending.set(id,{resolve,reject,timer:setTimeout(()=>reject(Error('Popup CDP timeout: '+method)),10000)}));await cdp.send('Target.sendMessageToTarget',{sessionId,message:JSON.stringify({id,method,params})});return response;};
   const evaluate=async expression=>{const reply=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(reply.exceptionDetails)throw Error(reply.exceptionDetails.text);return reply.result.value;};
   for(let i=0;i<100;i++){if(await evaluate('document.body?.dataset.ready === "true"'))break;await new Promise(r=>setTimeout(r,50));}assert.equal(await evaluate('document.body.dataset.ready'),'true');
   if(touch)await send('Emulation.setTouchEmulationEnabled',{enabled:true});
   async function click(selector){const rect=await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.scrollIntoView({block:'nearest'});const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);if(touch){await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[rect]});await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}else{await send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...rect});await send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...rect});}}
   async function size(){const value=await evaluate('({body:document.body.offsetWidth,viewport:innerWidth,scroll:document.documentElement.scrollWidth,main:document.querySelector("main").clientWidth,mainScroll:document.querySelector("main").scrollWidth})');assert.equal(value.body,384);assert.ok(value.viewport>=384&&value.viewport<430,JSON.stringify(value));assert.ok(value.scroll<=value.viewport);assert.equal(value.mainScroll,value.main);return value;}
   const close=async()=>{await evaluate('setTimeout(()=>window.close(),0);true');for(let i=0;i<50;i++){if(!(await cdp.send('Target.getTargets')).targetInfos.some(t=>t.targetId===target.targetId))break;await new Promise(r=>setTimeout(r,50));}cdp.off('Target.receivedMessageFromTarget',listener);};
   const wait=async expression=>{for(let i=0;i<180;i++){if(await evaluate(expression).catch(()=>false))return;await new Promise(r=>setTimeout(r,50));}throw Error('Popup condition timed out: '+expression);};
   return {send,evaluate,click,size,close,wait};
  }
  let popup=await open();const sizes=[await popup.size()];
  await popup.wait('!document.querySelector("#destination").disabled');
  assert.equal(await popup.evaluate('document.querySelector("#destination").disabled'),false);
  await popup.click('[data-panel="tasks-panel"]');assert.equal(await popup.evaluate('document.querySelector("#tasks-panel").hidden'),false);sizes.push(await popup.size());
  await popup.click('[data-panel="plugins-panel"]');assert.equal(await popup.evaluate('document.querySelector("#plugins-panel").hidden'),false);sizes.push(await popup.size());
  if(!touch){await popup.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Home',code:'Home'});await popup.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Home',code:'Home'});}else await popup.click('[data-panel="collect-panel"]');
  assert.equal(await popup.evaluate('document.querySelector("#collect-panel").hidden'),false);
  await popup.click('[aria-label="当前页面采集说明"]');assert.equal(await popup.evaluate('document.querySelector(".help-tooltip").hidden'),false);
  await popup.click('[aria-label="当前页面采集说明"]');assert.equal(await popup.evaluate('document.querySelector(".help-tooltip").hidden'),true);
  await popup.click('.link-capture summary');assert.equal(await popup.evaluate('document.querySelector(".link-capture").open'),true);sizes.push(await popup.size());
  await popup.click('.link-capture summary');await popup.evaluate('document.querySelector("main").scrollTo(0,0);window.scrollTo(0,0)');
  const shot=await popup.send('Page.captureScreenshot');await writeFile(join(dir,label+'.png'),Buffer.from(shot.data,'base64'));
  await popup.close();
  // A failed connection and long error task must not change the next popup's width.
  await worker.evaluate(()=>chrome.storage.local.set({lastResult:{ok:false,message:'采集失败，请检查连接后重试。'.repeat(30)}}));
  popup=await open();await popup.wait('!document.querySelector("#destination").disabled');
  await popup.send('Network.enable');await popup.send('Network.setBlockedURLs',{urls:[base+'/api/collections']});await popup.send('Page.reload');await popup.wait('document.querySelector("#connection-retry")?.hidden === false');sizes.push(await popup.size());
  await popup.click('[data-panel="tasks-panel"]');assert.equal(await popup.evaluate('document.querySelector("#last-task").dataset.state'),'failed');sizes.push(await popup.size());
  await popup.click('[data-panel="collect-panel"]');await popup.send('Network.setBlockedURLs',{urls:[]});await popup.click('#connection-retry');
  for(let i=0;i<100;i++){if(await popup.evaluate('!document.querySelector("#destination").disabled'))break;await new Promise(r=>setTimeout(r,50));}assert.equal(await popup.evaluate('document.querySelector("#destination").disabled'),false);sizes.push(await popup.size());
  await popup.close();popup=await open();sizes.push(await popup.size());await popup.close();
  result.ui.push({label,sizes,nativeAction:true,tabs:true,helpCloses:true,expandedLinks:true,errorAndReconnect:true,closeAndReopen:true});
  await context.close();context=null;console.log('PASS native popup '+label);
 }
}finally{await context?.close();assert.equal(pin(),pinBefore);db.prepare('DELETE FROM tokens WHERE id=?').run(tokenId);db.close();result.authCleaned=true;await writeFile(join(dir,'result.json'),JSON.stringify(result,null,2));console.log('Evidence '+dir);}
