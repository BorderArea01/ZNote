import {chromium} from 'playwright';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {createApp} from '../server/app.js';
const dir=await mkdtemp(resolve('artifacts/x-browser-ui-'));
const source='https://x.com/Tir_al_/status/2107765375521939865';
const png=await sharp({create:{width:200,height:160,channels:3,background:'#658579'}}).png().toBuffer();
let embeds=0;
const runtime=createApp({dataDir:dir,staticDir:resolve('dist'),captureOptions:{page:async()=>{embeds++;throw Object.assign(Error('X 公开接口未返回内容'),{status:422});},image:async url=>{assert.match(url,/\/own[1-4]\?/);return png;}}});
const server=runtime.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
let context;
try{
 const setup=await fetch(base+'/api/auth/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'0123'})});const cookie=setup.headers.get('set-cookie').split(';')[0];
 const token=await(await fetch(base+'/api/tokens',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({name:'X UI',scope:'write'})})).json();
 for(const touch of [false,true]){
  context=await chromium.launchPersistentContext(join(dir,touch?'touch':'desktop'),{channel:'msedge',headless:true,hasTouch:touch,viewport:{width:touch?420:1200,height:850},args:[`--disable-extensions-except=${resolve('addons/browser/clipper')}`,`--load-extension=${resolve('addons/browser/clipper')}`]});
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');await worker.evaluate(config=>chrome.storage.local.set(config),{server:base,token:token.token,saveAction:'save'});
  await context.route('https://pbs.twimg.com/**',route=>route.fulfill({contentType:'image/png',body:png}));
  await context.route('https://x.com/**',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<!doctype html><body style="background:#17201e;color:#eee;font:16px system-ui"><article data-testid="tweet" style="padding:20px;max-width:560px"><a href="${source}"><time>作品时间</time></a><div data-testid="User-Name">作者<br>@Tir_al_</div><img src="https://pbs.twimg.com/profile_images/avatar.jpg" width="30"><div data-testid="tweetText">正文第一行<br>第二行 #画画 <img alt="🌿"></div><div style="display:grid;grid-template-columns:1fr 1fr">${[1,2,3,4].map(i=>`<a href="${source}/photo/${i}"><div data-testid="tweetPhoto"><img width="120" height="96" src="https://pbs.twimg.com/media/own${i}?format=jpg&name=small"></div></a>`).join('')}</div><div data-testid="quoteTweet"><a href="https://x.com/quote/status/123"><time>引用帖</time></a><div data-testid="tweetText">引用正文</div><div data-testid="tweetPhoto"><img width="30" src="https://pbs.twimg.com/media/quote?format=jpg"></div></div><div role="group"><button>回复</button></div></article><article data-testid="tweet"><a href="https://x.com/other/status/234"><time>其他帖</time></a><div data-testid="tweetText">提到 <a href="${source}">原帖链接</a></div><div data-testid="tweetPhoto"><img width="20" src="https://pbs.twimg.com/media/other?format=jpg"></div></article>`}));
  const page=await context.newPage();await page.goto(source);const save=page.locator('#znote-x-page-button');await save.waitFor();
  const click=node=>touch?node.tap():node.click();
  // Explicit full-text boundary and recovery; do not silently save truncation.
  await page.locator('article').first().evaluate(article=>{const b=document.createElement('button');b.dataset.testid='tweet-text-show-more-link';b.textContent='显示更多';article.append(b);});
  await click(save);await page.getByRole('status').filter({hasText:'展开这条推文'}).waitFor();assert.equal(runtime.captures.list().length,touch?1:0);
  await page.locator('[data-testid="tweet-text-show-more-link"]').evaluate(node=>node.remove());await click(save);await save.filter({hasText:'已保存'}).waitFor({timeout:20000});
  assert.equal(embeds,0);const rows=runtime.db.prepare('SELECT * FROM items WHERE deleted_at IS NULL ORDER BY group_index').all();assert.equal(rows.length,4);assert.ok(rows.every(r=>r.content.startsWith('正文第一行\n第二行 #画画 🌿')&&r.source_url===source));assert.equal(new Set(rows.map(r=>r.group_key)).size,1);
  await click(save);await save.filter({hasText:'已保存'}).waitFor();assert.equal(runtime.db.prepare('SELECT count(*) n FROM items').get().n,4);
  await page.screenshot({path:join(dir,`${touch?'touch':'desktop'}-saved.png`)});
  await click(page.getByRole('button',{name:'关闭采集提示'}));await page.locator('[data-znote-page-tools] .feedback').waitFor({state:'hidden'});
  // The popup and shared toolbar use the same reader; never read a quoted
  // post or a different article merely linking to the target.
  const data=await worker.evaluate(async({source})=>{const tabs=await chrome.tabs.query({});const tab=tabs.find(t=>t.url===source);return chrome.tabs.sendMessage(tab.id,{type:'x-post-page',url:source});},{source});assert.equal(data.browserPost.images.length,4);
  await page.locator('[data-testid="quoteTweet"]').evaluate(node=>{node.removeAttribute('data-testid');node.setAttribute('role','link');node.insertAdjacentHTML('afterbegin','<div data-testid="User-Name">引用作者</div>');});
  const quoted=await worker.evaluate(async({source})=>{const tab=(await chrome.tabs.query({})).find(t=>t.url===source);return chrome.tabs.sendMessage(tab.id,{type:'x-post-page',url:source});},{source});assert.equal(quoted.browserPost.images.length,4);
  await page.locator('article').first().evaluate(node=>node.remove());
  const missing=await worker.evaluate(async({source})=>{const tab=(await chrome.tabs.query({})).find(t=>t.url===source);return chrome.tabs.sendMessage(tab.id,{type:'x-post-page',url:source});},{source});assert.equal(missing.browserPost,null);
  await page.screenshot({path:join(dir,`${touch?'touch':'desktop'}.png`)});
  await context.close();context=null;
 }
 await writeFile(join(dir,'result.json'),JSON.stringify({desktop:true,touch:true,embedRequests:embeds,groupImages:4,identityBound:true,source:'fixture'},null,2));console.log('PASS X browser capture: desktop/touch, four originals, quote/avatar exclusion, full-text boundary, dedupe, close, no embed dependency; evidence '+dir);
}catch(error){
  if(context){for(const page of context.pages())console.log('UI:',await page.locator('[data-znote-page-tools] .feedback').innerText().catch(()=>''));const worker=context.serviceWorkers()[0];console.log('Tasks:',await worker?.evaluate(async()=>Object.values((await chrome.storage.session.get('mediaTasks')).mediaTasks||{}).map(t=>({status:t.status,message:t.message}))).catch(()=>[]));}
  console.log('Evidence:',dir);throw error;
}finally{await context?.close();for(const key of ['captures','imports','trash','backups','webhooks','weixin'])await runtime[key].stop();await new Promise(r=>server.close(r));runtime.db.close();}
