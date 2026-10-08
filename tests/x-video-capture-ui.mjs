import {chromium} from 'playwright';
import {mkdtemp,copyFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
import {createApp} from '../server/app.js';
const dir=await mkdtemp(resolve('artifacts/x-video-ui-')),source='https://x.com/Tir_al_/status/2107765375521939865',id=source.split('/').pop();
const high='https://video.twimg.com/ext_tw_video/1/vid/avc1/1280x720/high.mp4',low='https://video.twimg.com/ext_tw_video/1/vid/avc1/320x180/low.mp4';
const record={rest_id:id,legacy:{extended_entities:{media:[{type:'video',video_info:{variants:[{url:low,bitrate:10},{url:high,bitrate:100}]}}]}}};
let transferred=0,embeds=0;
const runtime=createApp({dataDir:dir,staticDir:resolve('dist'),captureOptions:{page:async()=>{embeds++;throw Error('public API unavailable');},video:async()=>assert.fail('must not re-extract URL'),image:async()=>assert.fail('must not save the video cover'),captureVideo:async({plan,dir})=>{assert.equal(plan.video_urls[0],high);transferred++;const path=join(dir,'video.mp4');await copyFile('tests/fixtures/sample.mp4',path);return {path,originalname:'video.mp4'};}}});
const server=runtime.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;let context;
try{
 const setup=await fetch(base+'/api/auth/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'0123'})});const cookie=setup.headers.get('set-cookie').split(';')[0];
 const token=await(await fetch(base+'/api/tokens',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({name:'video-ui',scope:'write'})})).json();
 for(const touch of [false,true]){
  context=await chromium.launchPersistentContext(join(dir,touch?'touch':'desktop'),{channel:'msedge',headless:true,hasTouch:touch,viewport:{width:touch?420:1200,height:850},args:[`--disable-extensions-except=${resolve('addons/browser/clipper')}`,`--load-extension=${resolve('addons/browser/clipper')}`]});
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');await worker.evaluate(config=>chrome.storage.local.set(config),{server:base,token:token.token});
  await context.route('https://x.com/**',route=>route.request().url().includes('/i/api/graphql/')?route.fulfill({contentType:'application/json',body:JSON.stringify({data:{tweet:record}})}):route.fulfill({contentType:'text/html; charset=utf-8',body:`<!doctype html><body style="background:#17201e;color:white;font:16px system-ui"><article data-testid="tweet" style="padding:20px"><a href="${source}"><time>作品时间</time></a><div data-testid="User-Name">作者<br>@Tir_al_</div><div data-testid="tweetText">视频作品正文 #视频</div><div data-testid="videoPlayer"><video src="blob:https://x.com/123456" controls width="300"></video></div></article>`}));
  const page=await context.newPage();await page.goto(source);const save=page.locator('#znote-x-page-button');await save.waitFor();const click=node=>touch?node.tap():node.click();
  // A blob URL alone must produce a recoverable error, not a text-only note.
  await click(save);await page.getByRole('status').filter({hasText:'视频地址'}).waitFor();assert.equal(runtime.db.prepare('SELECT count(*) n FROM items').get().n,touch?1:0);
  await page.evaluate(record=>document.querySelector('article').__reactProps$fixture={tweet:record},record);
  await click(save);await save.filter({hasText:'已保存'}).waitFor({timeout:20000});assert.equal(embeds,0);
  const rows=runtime.db.prepare('SELECT * FROM items WHERE deleted_at IS NULL').all();assert.equal(rows.length,1);assert.equal(rows[0].kind,'video');assert.ok(rows[0].content.includes('视频作品正文'));assert.equal(rows[0].source_url,source);assert.ok(rows[0].bytes>1000);
  // Re-read network data after SPA activity, without depending on React props.
  await page.evaluate(async()=>{delete document.querySelector('article').__reactProps$fixture;await fetch('/i/api/graphql/fixture/TweetDetail').then(r=>r.json());});
  const observed=await worker.evaluate(async source=>{const tab=(await chrome.tabs.query({})).find(t=>t.url===source);return chrome.tabs.sendMessage(tab.id,{type:'x-post-page',url:source});},source);assert.equal(observed.browserPost.video_urls[0],high);
  await page.locator('[data-testid="videoPlayer"]').evaluate(node=>node.remove());
  const cached=await worker.evaluate(async source=>{const tab=(await chrome.tabs.query({})).find(t=>t.url===source);return chrome.tabs.sendMessage(tab.id,{type:'x-post-page',url:source});},source);assert.equal(cached.browserPost.video,true);assert.equal(cached.browserPost.video_urls[0],high);
  await context.addCookies([{name:'znote_session',value:token.token,url:base,httpOnly:true,sameSite:'Strict'}]);await page.goto(base+'/#item/'+rows[0].id);const video=page.locator('[role="dialog"] video');await video.waitFor();await video.evaluate(v=>v.muted=true);await video.evaluate(v=>v.play());await page.waitForFunction(()=>document.querySelector('[role="dialog"] video')?.currentTime>0.2);await page.screenshot({path:join(dir,`${touch?'touch':'desktop'}-playback.png`)});await page.keyboard.press('Escape');await video.waitFor({state:'hidden'});
  await context.close();context=null;
 }
 await writeFile(join(dir,'result.json'),JSON.stringify({desktop:true,touch:true,embeds,transferred,videoRows:1,playback:true,source:'fixture'},null,2));console.log('PASS X video: own React/API variants, blob recovery, no cover/note fallback, no server re-extraction, real MP4 validation + playback desktop/touch; '+dir);
}catch(error){if(context)for(const p of context.pages())console.log(await p.locator('[data-znote-page-tools] .feedback').innerText().catch(()=>''));console.log('Evidence:',dir);throw error;}
finally{await context?.close();for(const key of ['captures','imports','trash','backups','webhooks','weixin'])await runtime[key].stop();await new Promise(r=>server.close(r));runtime.db.close();}
