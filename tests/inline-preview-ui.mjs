import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
const dir=await mkdtemp(resolve('artifacts/inline-preview-')),extension=resolve(process.env.ZNOTE_CLIPPER_DIR||'addons/browser/clipper');
const bytes=await readFile('tests/fixtures/sample.mp4');let context,denied=true,requests=[];
const live=process.env.ZNOTE_PREVIEW_LIVE==='1',base='http://127.0.0.1:3741';let db,token,tokenId,collection;
async function api(path,method='GET',body){const response=await fetch(base+path,{method,headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});const text=await response.text(),data=text?JSON.parse(text):null;assert.ok(response.ok,JSON.stringify(data));return data;}
const server=createServer(async(req,res)=>{
  assert.equal(req.headers.authorization,undefined,'ZNote token must never reach the source');
  const path=new URL(req.url,'http://fixture').pathname;requests.push(path);
  if(path==='/'){res.setHeader('Content-Security-Policy',"default-src 'self'; frame-src 'none'; script-src 'self'; style-src 'unsafe-inline'");res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><title>浮窗试播验收</title><body style="background:#20242c;color:white;font:18px system-ui;padding:20px"><h1>原页面 · 浮窗试播</h1><p>严苛 CSP、MP4、HLS、损坏文件与失败恢复</p>'+['direct.mp4','master.m3u8','bad.mp4','recover.mp4','fragment.mp4'].map(src=>`<video preload="none" src="/${src}" title="${src}" muted style="width:1px;height:1px"></video>`).join(''));return;}
  if(path==='/recover.mp4'&&denied){res.writeHead(403);res.end('expired');return;}
  if(path==='/direct.mp4'||path==='/recover.mp4'){res.setHeader('Content-Type','video/mp4');res.end(bytes);return;}
  if(path==='/fragment.mp4'){res.setHeader('Content-Type','video/mp4');res.end(bytes.subarray(0,751));return;}
  if(path==='/bad.mp4'){res.setHeader('Content-Type','video/mp4');res.end('not a video');return;}
  try{if(/^\/(?:master|video)\.m3u8$|^\/video\d+\.ts$/.test(path)){res.setHeader('Content-Type',path.endsWith('.ts')?'video/mp2t':'application/vnd.apple.mpegurl');res.end(await readFile('tests/fixtures/hls'+path));return;}}catch{}
  res.writeHead(404);res.end();
});await new Promise(r=>server.listen(0,'127.0.0.1',r));const source='http://127.0.0.1:'+server.address().port;
const report={strictPageCsp:true,checks:[]};
try{
  if(live){
    db=new DatabaseSync('data/znote.sqlite');db.exec('PRAGMA busy_timeout=5000');token='zn_'+randomBytes(32).toString('hex');tokenId=randomUUID();
    db.prepare('INSERT INTO tokens VALUES(?,?,?,?,?,?,?)').run(tokenId,'临时浮窗视频验收',createHash('sha256').update(token).digest('hex'),'write','api',new Date().toISOString(),new Date(Date.now()+600000).toISOString());
    collection=await api('/api/collections','POST',{name:'临时浮窗试播验收 '+randomUUID().slice(0,8)});
    const browser_post={id:'2107765375521939865',text:'X 视频入口验收',author:{name:'验收',screen_name:'fixture'},images:[],video:true,video_urls:['https://video.twimg.com/ext_tw_video/fixture/high.mp4']};
    const resolved=await api('/api/captures/resolve','POST',{text:'https://x.com/fixture/status/'+browser_post.id,browser_post});assert.equal(resolved.plan.kind,'video');assert.equal(resolved.plan.video_urls.length,1);report.currentXResolve=true;
  }
  for(const touch of [false,true]){
    context=await chromium.launchPersistentContext(join(dir,touch?'touch':'desktop'),{channel:'msedge',headless:true,viewport:touch?{width:390,height:844}:{width:1280,height:900},hasTouch:touch,isMobile:touch,args:['--mute-audio',`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});context.setDefaultTimeout(10000);
    const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');await worker.evaluate(config=>chrome.storage.local.set(config),live?{saveAction:'save',hover:false,server:base,token,collection_id:collection.id}:{saveAction:'download',hover:false});
    const page=await context.newPage();await page.goto(source);await page.bringToFront();
    const tools=page.locator('[data-znote-page-tools]');await tools.locator('.edge-tab').waitFor();if(touch)await tools.locator('.edge-tab').tap();else await tools.locator('.edge-tab').hover();
    await tools.getByRole('button',{name:'ZNote 视频嗅探'}).click();
    const overlay=page.locator('[data-znote-overlay]');await overlay.locator('.item').first().waitFor();
    const card=async name=>{const data=await worker.evaluate(()=>chrome.storage.session.get('sniffTabs'));const resource=Object.values(data.sniffTabs).flatMap(s=>s.resources).find(r=>r.url.split('?')[0].endsWith('/'+name));assert.ok(resource,'missing '+name);return overlay.locator(`[data-resource-id="${resource.id}"]`);};
    const pages=context.pages().length;
    await(await card('direct.mp4')).getByRole('button',{name:'预览',exact:true}).click();
    const frame=page.frameLocator('iframe[title="ZNote 浮窗视频试播"]');await frame.locator('body[data-state="playing"]').waitFor();assert.ok(await frame.locator('video').evaluate(v=>v.videoWidth)>0);assert.equal(context.pages().length,pages);
    await overlay.getByRole('button',{name:'扫描',exact:true}).click();assert.equal(await overlay.locator('iframe').count(),1);assert.ok(await frame.locator('video').evaluate(v=>v.currentTime)>=0);
    await(await card('master.m3u8')).getByRole('button',{name:'预览',exact:true}).click();await frame.locator('body[data-state="playing"]').waitFor();assert.ok(await frame.locator('video').evaluate(v=>v.videoWidth)>0);assert.equal(await overlay.locator('iframe').count(),1);
    await page.screenshot({path:join(dir,touch?'touch-hls.png':'desktop-hls.png')});
    let saved;
    if(live){
      await(await card('master.m3u8')).getByRole('button',{name:'保存知识库',exact:true}).click();await overlay.locator('.task-state.complete').first().waitFor({timeout:30000});
      const tasks=(await worker.evaluate(()=>chrome.storage.session.get('mediaTasks'))).mediaTasks;const task=Object.values(tasks).find(t=>t.status==='complete');assert.ok(task.itemId);saved=await api('/api/items/'+task.itemId);assert.equal(saved.kind,'video');assert.equal(saved.collection_id,collection.id);assert.ok(saved.bytes>1000);assert.equal(saved.source_url,source+'/');
    }
    await(await card('bad.mp4')).getByRole('button',{name:'预览',exact:true}).click();await frame.locator('body[data-state="failed"]').waitFor();assert.match(await frame.getByRole('status').innerText(),/无法|失败/);
    await page.evaluate(()=>fetch('/fragment.mp4').then(r=>r.arrayBuffer()));await overlay.getByRole('button',{name:'扫描',exact:true}).click();
    await(await card('fragment.mp4')).getByRole('button',{name:'预览',exact:true}).click();await frame.locator('body[data-state="failed"]').waitFor({timeout:20000});assert.match(await frame.getByRole('status').innerText(),/初始化片段/);
    denied=true;await(await card('recover.mp4')).getByRole('button',{name:'预览',exact:true}).click();await frame.locator('body[data-state="failed"]').waitFor();denied=false;await frame.getByRole('button',{name:'重试',exact:true}).click();await frame.locator('body[data-state="playing"]').waitFor();
    await frame.getByRole('button',{name:'试播说明'}).click();await frame.getByRole('tooltip').waitFor();assert.match(await frame.getByRole('tooltip').innerText(),/不代表.*完整/);await frame.getByRole('button',{name:'试播说明'}).click();
    await frame.locator('video').focus();await page.keyboard.press('Escape');await overlay.locator('iframe').waitFor({state:'detached'});assert.ok(await overlay.getByRole('dialog',{name:'ZNote 视频嗅探'}).isVisible());
    await(await card('master.m3u8')).getByRole('button',{name:'预览',exact:true}).click();await frame.locator('body[data-state="playing"]').waitFor();await overlay.getByRole('button',{name:'收起',exact:true}).click();assert.equal(await overlay.locator('iframe').count(),0);const count=requests.length;await page.waitForTimeout(600);assert.equal(requests.length,count);
    assert.equal(context.pages().length,pages);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    if(live){
      await context.addCookies([{name:'znote_session',value:token,url:base,httpOnly:true,sameSite:'Strict'}]);await page.goto(base+'/#item/'+saved.id);const dialog=page.getByRole('dialog').first();await dialog.waitFor();const player=dialog.locator('video');await player.waitFor();await player.evaluate(async v=>{v.muted=true;await v.play();});await page.waitForFunction(()=>document.querySelector('[role="dialog"] video')?.currentTime>.1);await page.screenshot({path:join(dir,touch?'touch-library.png':'desktop-library.png')});await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
    }
    report.checks.push({touch,mp4:true,hls:true,fragmentFailure:true,retry:true,sameTab:true,singlePlayer:true,retainsOnScan:true,closeStops:true,...(live?{actualSaveAndPlayback:true}:{})});console.log('Passed inline preview',touch);
    await context.close();context=null;await rm(join(dir,touch?'touch':'desktop'),{recursive:true,force:true});
  }
  await writeFile(join(dir,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({evidence:dir,...report}));
}catch(error){if(context)for(const p of context.pages()){await p.screenshot({path:join(dir,'failure.png')}).catch(()=>{});console.log(await p.locator('[data-znote-overlay] .status').innerText().catch(()=>''));}console.log('Evidence',dir);throw error;}
finally{
  await context?.close();await new Promise(r=>server.close(r));
  try{if(collection){const ids=db.prepare('SELECT id FROM items WHERE collection_id=?').all(collection.id).map(r=>r.id);for(const id of ids)await api('/api/items/'+id,'DELETE');if(ids.length){const input={collection_id:collection.id,ids},preview=await api('/api/trash/preview','POST',input);assert.equal(preview.referenced,0);await api('/api/trash/purge','POST',{...input,revision:preview.revision,confirm:'DELETE'});}await api('/api/collections/'+collection.id,'DELETE');}}
  finally{if(db){db.prepare('DELETE FROM tokens WHERE id=?').run(tokenId);db.close();}}
}
