import {chromium} from 'playwright';
import {mkdtemp} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {createApp} from '../server/app.js';
const dir=await mkdtemp(resolve('artifacts/clipper-entry-')),source='https://x.com/artist/status/2107462064294051944';
const pngs=await Promise.all(['#486b50','#bba885'].map(background=>sharp({create:{width:100,height:150,channels:3,background}}).png().toBuffer()));
let fail=false;
const runtime=createApp({dataDir:dir,captureOptions:{page:async()=>{if(fail)throw Object.assign(Error('测试平台暂时不可用'),{status:422});return {plan:{kind:'note',url:source,title:'测试作品',content:'作品正文',images:['https://pbs.twimg.com/media/one.jpg','https://pbs.twimg.com/media/two.jpg']}};},image:async url=>pngs[url.includes('one')?0:1]}});
const server=runtime.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
let context;
try{
 for(const touch of [false,true]){
  context=await chromium.launchPersistentContext(join(dir,touch?'touch':'desktop'),{channel:'msedge',headless:true,hasTouch:touch,viewport:{width:touch?390:1100,height:840},args:[`--disable-extensions-except=${resolve('addons/browser/clipper')}`,`--load-extension=${resolve('addons/browser/clipper')}`]});
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker'),origin='chrome-extension://'+new URL(worker.url()).host;
  await context.request.post(base+(touch?'/api/auth/login':'/api/auth/setup'),{data:{password:'0123'}});
  const token=await (await context.request.post(base+'/api/tokens',{data:{name:'entry-ui',scope:'write'}})).json();
  const collection=await (await context.request.post(base+'/api/collections',{data:{name:touch?'触屏采集':'桌面采集'}})).json();
  await worker.evaluate(config=>chrome.storage.local.set(config),{server:base,token:token.token,collection_id:collection.id});
  const fixture=(noTime=false,noGroup=false,quote=false)=>`<!doctype html><html><head><meta charset="utf-8"><title>X 作品详情</title></head><body style="background:#111;color:white;font:16px system-ui;padding:20px"><article data-testid="tweet" style="width:min(580px,100%)">${noTime?'':`<a href="${source}"><time>今天</time></a>`}<div data-testid="tweetText">作品正文 · 详情页</div><div ${quote?'data-testid="quoteTweet"':''}><a href="${source}/photo/1"><div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/media/one.jpg" width="150" height="200"></div></a></div>${noGroup?'':'<div role="group" style="display:flex;gap:28px;margin-top:15px"><button>回复</button><button>转发</button></div>'}</article></body></html>`;
  let shape=fixture();await context.route('https://x.com/**',route=>route.fulfill({contentType:'text/html',body:shape}));await context.route('https://pbs.twimg.com/**',route=>route.fulfill({contentType:'image/png',body:pngs[0]}));
  const tab=await context.newPage();await tab.goto(source);const click=locator=>touch?locator.tap():locator.click();
  const entry=tab.getByRole('button',{name:'保存这条推文的全部图片到 ZNote'});await entry.waitFor();
  shape=fixture(true,true);await tab.goto('https://x.com/home');await tab.locator('article .znote-x-post-button').waitFor();assert.equal(await tab.locator('#znote-x-page-button').count(),0);assert.equal(await tab.locator('article .znote-x-post-button').getAttribute('data-url'),source);
  shape=fixture(true,true,true);await tab.reload();await tab.waitForTimeout(400);assert.equal(await tab.locator('.znote-x-post-button').count(),0,'quoted images must not create a feed entry');
  shape=fixture();await tab.goto(source);await entry.waitFor();await tab.evaluate(()=>history.pushState({},'', '/other/status/123456789/photo/1'));await tab.locator('#znote-x-page-button[data-url="https://x.com/other/status/123456789"]').waitFor();await tab.goto(source);await entry.waitFor();
  shape=fixture(true,true);await tab.reload();await entry.waitFor();assert.equal(new URL(await entry.getAttribute('data-url')).pathname,'/artist/status/2107462064294051944');
  await tab.screenshot({path:resolve(`artifacts/x-detail-entry-${touch?'touch':'desktop'}.png`)});
  await worker.evaluate(()=>chrome.storage.local.set({blockedSites:['x.com']}));await entry.waitFor({state:'hidden'});await worker.evaluate(()=>chrome.storage.local.set({blockedSites:[]}));await entry.waitFor();
  shape=fixture(true,true,true);await tab.reload();await tab.waitForTimeout(400);assert.equal(await tab.locator('article .znote-x-post-button').count(),0,'quoted media alone must not create a card capture button');shape=fixture(true,true);await tab.reload();await entry.waitFor();
  const popup=await context.newPage();await tab.bringToFront();await popup.goto(origin+'/popup.html');await popup.waitForFunction(()=>document.body.dataset.ready==='true');await popup.locator('#destination:enabled').waitFor();assert.equal(await popup.locator('#destination').inputValue(),collection.id);await popup.locator('#site-name').filter({hasText:'x.com'}).waitFor();
  assert.equal(await popup.locator('#collect-panel').isVisible(),true);assert.equal(await popup.locator('#tasks-panel').isHidden(),true);assert.equal(await popup.locator('#gallery-link').isHidden(),true);
  await popup.locator('body').screenshot({path:resolve(`artifacts/entry-collect-${touch?'touch':'desktop'}.png`)});
  if(!touch){await popup.getByRole('tab',{name:'采集',exact:true}).focus();await popup.keyboard.press('ArrowRight');assert.equal(await popup.getByRole('tab',{name:/任务/}).getAttribute('aria-selected'),'true');await popup.keyboard.press('End');}
  else await click(popup.getByRole('tab',{name:'插件',exact:true}));
  await popup.getByRole('checkbox',{name:'常驻媒体浮窗'}).uncheck();assert.equal((await worker.evaluate(()=>chrome.storage.local.get('dock'))).dock,false);
  const help=popup.getByRole('button',{name:'其他插件管理说明'});await click(help);await popup.waitForTimeout(250);assert.equal(await help.getAttribute('aria-expanded'),'true');await popup.keyboard.press('Escape');assert.equal(await help.getAttribute('aria-expanded'),'false');
  await popup.locator('body').screenshot({path:resolve(`artifacts/entry-plugins-${touch?'touch':'desktop'}.png`)});assert.equal(await popup.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await worker.evaluate(async source=>{const tab=(await chrome.tabs.query({})).find(t=>t.url===source);await chrome.storage.session.set({mediaTasks:{one:{id:'one',tabId:tab.id,status:'complete',itemId:'saved-media',title:'后台视频',message:'已保存到知识库',updated:Date.now()}}});},source);
  await click(popup.getByRole('tab',{name:/任务/}));await popup.locator('#media-task-list a[href$="saved-media"]').waitFor();
  await click(popup.getByRole('tab',{name:'采集',exact:true}));await popup.locator('#destination').selectOption('');assert.equal((await worker.evaluate(()=>chrome.storage.local.get('collection_id'))).collection_id,'');await popup.locator('#destination').selectOption(collection.id);
  fail=true;await click(popup.getByRole('button',{name:'采集当前作品',exact:true}));await popup.getByRole('button',{name:'重试作品采集'}).waitFor();assert.match(await popup.locator('#gallery-status').innerText(),/暂时不可用/);
  fail=false;await click(popup.getByRole('button',{name:'重试作品采集'}));await popup.locator('#gallery-open:not([hidden])').waitFor();assert.match(await popup.locator('#gallery-status').innerText(),/图片组已入库/);
  const rows=runtime.db.prepare('SELECT group_key,content FROM items WHERE collection_id=? AND deleted_at IS NULL').all(collection.id);assert.equal(rows.length,2);assert.equal(new Set(rows.map(row=>row.group_key)).size,1);assert.ok(rows.every(row=>row.content.includes('作品正文')));
  await popup.locator('body').screenshot({path:resolve(`artifacts/entry-tasks-${touch?'touch':'desktop'}.png`)});await popup.reload();await popup.locator('#destination:enabled').waitFor();assert.equal(await popup.locator('#destination').inputValue(),collection.id);assert.equal(await popup.getByRole('button',{name:'采集当前作品',exact:true}).isEnabled(),true);
  await context.close();context=null;
 }
 console.log('PASS real extension: desktop/touch/keyboard tabs, destination persistence, feature switches, pinned help, failed capture retry, task results, next capture enabled, X detail without time/action row, quoted images excluded and blacklist recovery');
}finally{await context?.close();for(const key of ['captures','imports','trash','backups','webhooks','weixin'])await runtime[key].stop();await new Promise(r=>server.close(r));runtime.db.close();}
