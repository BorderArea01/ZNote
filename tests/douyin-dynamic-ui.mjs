import {chromium} from 'playwright';
import {mkdtemp,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {createApp} from '../server/app.js';
const dir=await mkdtemp(resolve('artifacts/douyin-dynamic-')),runtime=createApp({dataDir:join(dir,'data')}),server=runtime.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
const bytes=await readFile('tests/fixtures/sample.mp4'),poster=await sharp({create:{width:320,height:180,channels:3,background:'#7667dd'}}).png().toBuffer();
const extension=resolve('extensions/clipper'),context=await chromium.launchPersistentContext(join(dir,'profile'),{channel:'msedge',headless:true,args:['--mute-audio','--disable-extensions-except='+extension,'--load-extension='+extension]}),worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker'),page=await context.newPage();
const urlA='https://v26-web.douyinvod.com/sign/expiry/video/tos/cn/bucket/work-a/',urlB='https://sf6-cdn-tos.douyinstatic.com/obj/tos-cn-ve/work-a.mp4',urlC='https://v26-web.douyinvod.com/sign/expiry/video/tos/cn/bucket/work-b/';
const work=(id,name,urls)=>({aweme_id:id,desc:'作品 '+id,author:{nickname:name,sec_uid:'MS4w_'+id},video:{play_addr:{url_list:urls},cover:{url_list:['https://p3.douyinpic.com/cover.png']}}});
let payload={aweme_list:[work('111','动态作者甲',[urlA,urlB]),work('222','动态作者乙',[urlC])],private_field:'must-not-cross-bridge'};
try{
 const post=async(path,data)=>{const r=await context.request.post(base+path,{data});assert.ok(r.ok(),await r.text());return r.json()};await post('/api/auth/setup',{password:'0912'});const token=await post('/api/tokens',{name:'采集测试',scope:'write'}),library=await post('/api/collections',{name:'视频素材'});
 await worker.evaluate(config=>chrome.storage.local.set(config),{server:base,token:token.token,collection_id:library.id,tags:'参考'});
 await context.route('https://**/*',async route=>{
  const u=new URL(route.request().url());
  if(u.hostname.endsWith('douyinvod.com')||u.hostname.endsWith('douyinstatic.com'))return route.fulfill({contentType:'video/mp4',body:bytes,headers:{'Access-Control-Allow-Origin':'*'}});
  if(u.hostname.endsWith('douyinpic.com'))return route.fulfill({contentType:'image/png',body:poster,headers:{'Access-Control-Allow-Origin':'*'}});
  if(u.pathname.startsWith('/aweme/'))return route.fulfill({contentType:'application/json',body:JSON.stringify(payload)});
  return route.fulfill({contentType:'text/html; charset=utf-8',body:'<!doctype html><title>抖音</title><h1>动态收藏列表</h1><nav><a href="/user/self">我的账号</a></nav><main><video muted></video><div data-e2e="comment-list"><a href="/user/comment">评论作者</a></div></main>'});
 });
 await page.goto('https://www.douyin.com/user/self?showTab=favorite_collection');
 await page.evaluate(()=>{window.bridgeRows=[];window.addEventListener('message',e=>{if(e.data?.type==='znote-douyin-observe'){window.observed=e.data.enabled;window.observeOrigin={origin:e.origin,same:e.source===window}};if(e.data?.type==='znote-douyin-works')window.bridgeRows.push(e.data.rows)})});
 page.on('pageerror',e=>console.log('PAGE ERROR',e.message));
 const ui=page.locator('[data-znote-overlay]');await ui.getByRole('button',{name:'ZNote 视频嗅探',exact:true}).click();await page.waitForFunction(()=>window.observed===true);
 // No hydration or author DOM. Work data arrives after opening the panel.
 assert.equal(await page.evaluate(async()=>{const data=await(await fetch('/aweme/v1/web/aweme/favorite/')).json();return data.private_field}),'must-not-cross-bridge');
 await page.evaluate(async urls=>{for(const url of urls)await(await fetch(url)).arrayBuffer()},[urlA+'?temp=1&__vid=one',urlB+'?temp=2',urlC+'?temp=3']);
 await ui.getByRole('button',{name:'扫描',exact:true}).click();
  const a=ui.locator('.item').filter({hasText:'作者：动态作者甲'}),b=ui.locator('.item').filter({hasText:'作者：动态作者乙'});
 await a.waitFor();await b.waitFor();assert.equal(await ui.locator('.item').count(),2);assert.equal(await a.locator('select option').count(),2);
 await a.locator('img.thumb').evaluate(img=>img.decode());assert.ok(await a.locator('img.thumb').evaluate(img=>img.naturalWidth===320));
 assert.ok(!(await page.evaluate(()=>JSON.stringify(window.bridgeRows))).includes('must-not-cross-bridge'));
 await a.locator('select').selectOption({index:1});await a.waitFor();
 const opened=context.waitForEvent('page');await a.getByRole('button',{name:'保存知识库',exact:true}).click();const media=await opened;await media.getByText('已保存到知识库',{exact:true}).waitFor();
 const list=await(await context.request.get(base+'/api/items?kind=video&collection='+library.id)).json();assert.equal(list.total,1);assert.ok(list.items[0].tags.includes('动态作者甲'));assert.ok(!list.items[0].tags.includes('动态作者乙'));assert.equal(list.items[0].source_url,'https://www.douyin.com/video/111');
 await page.screenshot({path:resolve('artifacts/v0912-sniffer-desktop.png')});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:resolve('artifacts/v0912-sniffer-mobile.png')});assert.ok(await ui.locator('.panel').evaluate(el=>el.getBoundingClientRect().left>=0));
 // XHR arrivals also enrich the correct work and update the visible author.
 payload={aweme_detail:work('111','XHR 作者',[urlA,urlB])};
 assert.equal(await page.evaluate(()=>new Promise((yes,no)=>{const x=new XMLHttpRequest();x.open('GET','/aweme/v1/web/aweme/detail/');x.responseType='json';x.onload=()=>yes(x.response.aweme_detail.author.nickname);x.onerror=no;x.send()})),'XHR 作者');
 await ui.locator('.item').filter({hasText:'作者：XHR 作者'}).waitFor();
 // The page may have already loaded a work before sniffing starts. Read its
 // mounted React props on demand without treating comments as work authors.
 await ui.getByRole('button',{name:'暂停嗅探',exact:true}).click();payload={aweme_detail:work('333','暂停时作者',[urlC])};
 await page.waitForFunction(()=>window.observed===false);await page.evaluate(()=>history.pushState({},'',location.pathname+'?showTab=favorite_collection&modal_id=222'));
 const before=await page.evaluate(()=>window.bridgeRows.length);await page.evaluate(async()=>await(await fetch('/aweme/v1/web/aweme/detail/')).json());assert.equal(await page.evaluate(()=>window.bridgeRows.length),before);assert.equal(await page.evaluate(()=>window.observed),false);
 const mounted=work('222','已加载作者',[urlC]);await page.locator('video').evaluate((video,work)=>video.__reactProps$fixture={awemeInfo:work},mounted);
 await ui.getByRole('button',{name:'继续嗅探',exact:true}).click();await ui.locator('.item').filter({hasText:'作者：已加载作者'}).waitFor();
 console.log('PASS dynamic Douyin: fetch/XHR + mounted props, no response secrets, separate work authors, visible poster, variant grouping/selection, real API author tag, mobile layout and pause');
}finally{await context.close();await runtime.trash.stop();await runtime.imports.stop();await runtime.backups.stop();await runtime.webhooks.stop();await new Promise(r=>server.close(r));runtime.db.close()}
