// Actual extension and current ZNote instance; synthetic authorized player and
// CDN responses are explicit fixtures, not evidence of a logged-in YouTube session.
import {chromium} from 'playwright';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createServer} from 'node:https';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {mediaTools,runMediaCommand} from '../server/imports.js';
const dir=await mkdtemp(resolve('artifacts/youtube-live-')),base='http://127.0.0.1:3741',source='https://www.youtube.com/watch?v=TuR6De4SI5c';
const db=new DatabaseSync('data/znote.sqlite');db.exec('PRAGMA busy_timeout=5000');
const hash=value=>createHash('sha256').update(value).digest('hex');
const token='zn_'+randomBytes(32).toString('hex'),tokenId=randomUUID();
const pin=db.prepare("SELECT value FROM settings WHERE key='password'").get()?.value;
db.prepare('INSERT INTO tokens VALUES(?,?,?,?,?,?,?)').run(tokenId,'临时 YouTube 音画采集验收',hash(token),'write','api',new Date().toISOString(),new Date(Date.now()+900000).toISOString());
async function api(path,method='GET',body){const response=await fetch(base+path,{method,headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});const text=await response.text(),result=text?JSON.parse(text):null;assert.ok(response.ok,JSON.stringify(result));return result;}
let context,collection,cdn;const report={fixturePlayer:true,actualExtension:true,actualServer:true,checks:[]};
try{
  collection=await api('/api/collections','POST',{name:'临时 YouTube 验收 '+randomUUID().slice(0,8)});
  const videoPath=join(dir,'video.mp4'),audioPath=join(dir,'audio.m4a');
  await runMediaCommand(mediaTools().ffmpeg,['-v','error','-nostdin','-i',resolve('tests/fixtures/sample.mp4'),'-an','-c:v','copy',videoPath]);
  await runMediaCommand(mediaTools().ffmpeg,['-v','error','-nostdin','-f','lavfi','-i','sine=frequency=400:duration=1','-threads','1','-c:a','aac',audioPath]);
  const video=await readFile(videoPath),audio=await readFile(audioPath);
  const key=join(dir,'fixture.key'),cert=join(dir,'fixture.pem');
  assert.ok(process.env.ZNOTE_TEST_PYTHON,'Set ZNOTE_TEST_PYTHON to a Python interpreter with cryptography for this isolated TLS fixture');
  execFileSync(process.env.ZNOTE_TEST_PYTHON,['-c',`from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from datetime import datetime, timedelta, timezone
import sys
k=rsa.generate_private_key(public_exponent=65537,key_size=2048)
n=x509.Name([x509.NameAttribute(x509.NameOID.COMMON_NAME,'r1.googlevideo.com')])
now=datetime.now(timezone.utc)
c=x509.CertificateBuilder().subject_name(n).issuer_name(n).public_key(k.public_key()).serial_number(x509.random_serial_number()).not_valid_before(now-timedelta(minutes=1)).not_valid_after(now+timedelta(days=1)).sign(k,hashes.SHA256())
open(sys.argv[1],'wb').write(k.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.NoEncryption()))
open(sys.argv[2],'wb').write(c.public_bytes(serialization.Encoding.PEM))`,key,cert],{windowsHide:true,stdio:'ignore'});
  let denied=false,cdnRequests=0;
  cdn=createServer({key:await readFile(key),cert:await readFile(cert)},(req,res)=>{
    assert.equal(req.headers.authorization,undefined);cdnRequests++;
    if(denied){res.writeHead(403);res.end('Expired authorization');return;}
    const u=new URL(req.url,'https://r1.googlevideo.com'),buffer=u.searchParams.get('itag')==='140'?audio:video;
    const [start,end]=u.searchParams.get('range').split('-').map(Number);
    res.writeHead(200,{'Content-Type':u.searchParams.get('itag')==='140'?'audio/mp4':'video/mp4','Access-Control-Allow-Origin':'*'});res.end(buffer.subarray(start,end+1));
  });await new Promise(r=>cdn.listen(0,'127.0.0.1',r));
  const stream=(itag,mime,bytes)=>({itag,mimeType:mime,contentLength:String(bytes.length),url:`https://r1.googlevideo.com/videoplayback?id=fixture&itag=${itag}&clen=${bytes.length}&range=0-1`});
  const player={playabilityStatus:{status:'OK'},videoDetails:{videoId:'TuR6De4SI5c',title:'YouTube 音画采集验收',author:'验收来源'},streamingData:{adaptiveFormats:[stream(137,'video/mp4; codecs="avc1.640028"',video),stream(140,'audio/mp4; codecs="mp4a.40.2"',audio)]}};
  const extension=resolve(process.env.ZNOTE_TEST_EXTENSION||'addons/browser/clipper');
  for(const touch of [false,true]){
    context=await chromium.launchPersistentContext(join(dir,touch?'touch-profile':'desktop-profile'),{channel:'msedge',headless:true,viewport:touch?{width:390,height:844}:{width:1280,height:850},hasTouch:touch,isMobile:touch,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`,'--mute-audio','--proxy-server=direct://','--ignore-certificate-errors',`--host-resolver-rules=MAP r1.googlevideo.com 127.0.0.1:${cdn.address().port}`]});
    context.setDefaultTimeout(10000);
    const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
    await worker.evaluate(config=>chrome.storage.local.set(config),{server:base,token,collection_id:collection.id,saveAction:'save',hover:false});
    await context.route('https://www.youtube.com/**',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><meta charset="utf-8"><title>YouTube 授权播放器测试</title><body style="margin:32px;background:#17191d;color:white;font:18px system-ui"><h1>已授权播放器测试</h1><p>实际扩展 → 完整画面和声音 → 当前 ZNote 服务</p><div id="movie_player"></div><script>window.fixturePlayer=${JSON.stringify(player)};document.querySelector('#movie_player').getPlayerResponse=()=>window.fixturePlayer;</script>`}));
    denied=false;cdnRequests=0;
    const page=await context.newPage();const pageErrors=[];page.on('pageerror',e=>pageErrors.push(e.message));await page.goto(source);await page.bringToFront();console.log('Opened authorized-player fixture',touch);
    const tools=page.locator('[data-znote-page-tools]'),tab=tools.getByRole('button',{name:/展开 ZNote 采集工具/});await tab.waitFor();
    console.log('Tool tab ready',touch);if(touch)await tab.tap();else await tab.hover();console.log('Tool tab expanded',touch);
    const save=tools.getByRole('button',{name:'采集当前作品',exact:true});await save.waitFor({state:'visible'});
    if(touch)await save.tap();else await save.click();
    try{await tools.getByRole('status').filter({hasText:/已保存到知识库|知识库已收录/}).waitFor({timeout:25000});}catch(error){console.log('Feedback:',await tools.getByRole('status').innerText(),'CDN requests:',cdnRequests,'Tasks:',await worker.evaluate(()=>chrome.storage.session.get('mediaTasks')));await page.screenshot({path:join(dir,'failure.png')});throw error;}
    assert.equal(cdnRequests,2);assert.equal(context.pages().filter(p=>!p.url().startsWith('chrome-extension:')).length,2); // initial blank + original page
    const tasks=await worker.evaluate(()=>chrome.storage.session.get('mediaTasks'));const task=Object.values(tasks.mediaTasks)[0];assert.equal(task.status,'complete');assert.ok(task.itemId);
    const item=await api('/api/items/'+task.itemId);assert.equal(item.source_url,source);assert.equal(item.collection_id,collection.id);assert.ok(item.bytes>video.length);
    const actualFile=join(dir,'actual-library.mp4'),actualResponse=await fetch(base+'/media/'+item.id+'/original',{headers:{Authorization:'Bearer '+token}});assert.equal(actualResponse.status,200);await writeFile(actualFile,Buffer.from(await actualResponse.arrayBuffer()));
    await runMediaCommand(mediaTools().ffmpeg,['-v','error','-i',actualFile,'-map','0:v:0','-map','0:a:0','-f','null','-']);await rm(actualFile,{force:true});
    await page.screenshot({path:join(dir,touch?'touch-success.png':'desktop-success.png')});
    // Authorization failures keep the page open and make retry available.
    denied=true;await page.reload();if(touch)await tab.tap();else await tab.hover();if(touch)await save.tap();else await save.click();
    await tools.getByRole('status').filter({hasText:/播放授权已过期/}).waitFor({timeout:15000});
    await tools.getByRole('button',{name:'关闭采集提示'}).click();await tools.getByRole('status').waitFor({state:'hidden'});
    assert.ok(await save.isEnabled());
    // Resume succeeds without reloading the extension or creating a new page.
    denied=false;await save.click();await tools.getByRole('status').filter({hasText:/知识库已收录|已保存到知识库/}).waitFor({timeout:45000});
    await page.evaluate(url=>{const video=document.createElement('video');video.preload='none';video.src=url;document.body.append(video);},player.streamingData.adaptiveFormats[0].url);
    const beforeTasks=Object.keys((await worker.evaluate(()=>chrome.storage.session.get('mediaTasks'))).mediaTasks);
    await tools.locator('[data-tool="video"]').click();
    await page.getByRole('button',{name:'保存知识库',exact:true}).first().click();
    let sniffTask;
    for(let attempt=0;attempt<100;attempt++){const tasks=await worker.evaluate(()=>chrome.storage.session.get('mediaTasks'));sniffTask=Object.values(tasks.mediaTasks).find(t=>!beforeTasks.includes(t.id));if(sniffTask?.status==='complete')break;if(sniffTask)assert.notEqual(sniffTask.status,'failed',sniffTask.message);await page.waitForTimeout(100);}
    assert.equal(sniffTask?.status,'complete');
    // Wrong-work and gated data fail before any CDN request.
    await page.reload();await page.evaluate(()=>{window.fixturePlayer.videoDetails.videoId='abcdefghijk';});if(touch)await tab.tap();else await tab.hover();await save.click();await tools.getByRole('status').filter({hasText:/页面作品已切换/}).waitFor();
    await page.evaluate(()=>{window.fixturePlayer.playabilityStatus.status='LOGIN_REQUIRED';});await save.click();await tools.getByRole('status').filter({hasText:/请先在 YouTube 登录/}).waitFor();
    // The saved MP4 is playable in the real current gallery UI with audio.
    await context.addCookies([{name:'znote_session',value:token,url:base,httpOnly:true,sameSite:'Strict'}]);await page.goto(base+'/#item/'+item.id);const dialog=page.getByRole('dialog').first();await dialog.waitFor();
    const media=dialog.locator('video');await media.waitFor();await media.evaluate(v=>new Promise((yes,no)=>{if(v.readyState>=1)return yes();v.addEventListener('loadedmetadata',()=>yes(),{once:true});v.addEventListener('error',()=>no(Error('Video decode failed')),{once:true});v.load();}));
    const metadata=await media.evaluate(v=>({width:v.videoWidth,duration:v.duration}));assert.ok(metadata.width>0);assert.ok(metadata.duration>0);metadata.actualStoredAudioDecoded=true;
    await media.evaluate(async v=>{v.muted=true;await v.play();});await page.waitForTimeout(250);assert.ok(await media.evaluate(v=>v.currentTime)>0);await media.evaluate(v=>v.pause());
    await page.screenshot({path:join(dir,touch?'touch-playback.png':'desktop-playback.png')});
    await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});assert.equal(pageErrors.length,0,pageErrors.join('\n'));
    report.checks.push({touch,save:true,sniffer:true,samePage:true,source:true,audioVideoMerge:true,expiredFailure:true,retry:true,workMismatch:true,gated:true,playback:metadata});
    await context.close();context=null;await rm(join(dir,touch?'touch-profile':'desktop-profile'),{recursive:true,force:true});
  }
  report.health=await(await fetch(base+'/api/health')).json();console.log(JSON.stringify(report));
}finally{
  await context?.close();
  if(cdn)await new Promise(r=>cdn.close(r));
  if(collection){const ids=db.prepare('SELECT id FROM items WHERE collection_id=?').all(collection.id).map(x=>x.id);for(const id of ids)await api('/api/items/'+id,'DELETE');if(ids.length){const input={collection_id:collection.id,ids},preview=await api('/api/trash/preview','POST',input);assert.equal(preview.referenced,0);await api('/api/trash/purge','POST',{...input,revision:preview.revision,confirm:'DELETE'});}await api('/api/collections/'+collection.id,'DELETE');}
  assert.equal(db.prepare("SELECT value FROM settings WHERE key='password'").get()?.value,pin);db.prepare('DELETE FROM tokens WHERE id=?').run(tokenId);db.close();await writeFile(join(dir,'result.json'),JSON.stringify(report,null,2));
  await rm(join(dir,'video.mp4'),{force:true});await rm(join(dir,'audio.m4a'),{force:true});
  await rm(join(dir,'fixture.key'),{force:true});await rm(join(dir,'fixture.pem'),{force:true});
}
