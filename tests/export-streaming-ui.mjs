import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {networkInterfaces} from 'node:os';
import {randomBytes,createHash} from 'node:crypto';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import yauzl from 'yauzl';
import sharp from 'sharp';
import {createApp} from '../server/app.js';

const dir=await mkdtemp(resolve('artifacts/export-stream-ui-')),runtime=createApp({dataDir:dir,staticDir:resolve(process.env.UI_DIST||'dist')});
let releaseOutput,holdOutput=true;
const server=createServer((req,res)=>{
  if(holdOutput&&/^\/api\/export-jobs\/[^/]+\/file$/.test(req.url)){
    holdOutput=false;const write=res.write.bind(res);let first=true;
    res.write=(...args)=>{const result=write(...args);if(first){first=false;releaseOutput=()=>res.emit('drain');return false;}return result;};
  }
  runtime.app(req,res);
}).listen(0,'0.0.0.0');await new Promise(r=>server.once('listening',r));
const base='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({channel:'msedge',headless:true}),context=await browser.newContext({acceptDownloads:true,viewport:{width:1366,height:768}}),page=await context.newPage(),errors=[];
page.on('pageerror',e=>errors.push(e.message));
await context.addInitScript(()=>{const original=Response.prototype.blob;Response.prototype.blob=function(...args){if(this.url.includes('/api/export'))throw Error('Export attempted full Blob buffering');return original.apply(this,args);};});
const post=async(path,data)=>{const r=await context.request.post(base+path,{data});assert.ok(r.ok(),await r.text());return r.json();};
try{
  await post('/api/auth/setup',{password:'0924'});const a=await post('/api/collections',{name:'流式导出'}),b=await post('/api/collections',{name:'其他资料'});await context.request.patch(base+'/api/preferences',{data:{default_collection_id:a.id}});
  const png=await sharp({create:{width:8,height:8,channels:3,background:'#7885aa'}}).png().toBuffer();
  const uploaded=await context.request.post(base+'/api/assets',{multipart:{file:{name:'原图.png',mimeType:'image/png',buffer:png},collection_id:a.id}});assert.ok(uploaded.ok());const item=await uploaded.json();
  // An isolated 8 MiB immutable original makes an unfinished native transfer observable.
  const sample=await readFile(resolve('tests/fixtures/sample.mp4')),free=randomBytes(8*1024*1024-sample.length);free.writeUInt32BE(free.length,0);free.write('free',4);
  const original=Buffer.concat([sample,free]),hash=createHash('sha256').update(original).digest('hex');await writeFile(join(dir,'media/large-video.bin'),original);
  runtime.db.prepare("UPDATE items SET kind='video',mime='video/mp4',file_key='large-video.bin',storage_codec='identity',bytes=?,stored_bytes=?,hash=?,title='导出视频.mp4' WHERE id=?").run(original.length,original.length,hash,item.id);
  await page.goto(base);await page.getByRole('button',{name:'导出',exact:true}).click();const dialog=page.getByRole('dialog',{name:'导出知识库',exact:true}),downloadEvent=page.waitForEvent('download');await dialog.getByRole('button',{name:'下载导出文件',exact:true}).click();const download=await downloadEvent;
  await dialog.getByRole('button',{name:'关闭窗口',exact:true}).click();await page.reload();await page.getByRole('button',{name:'任务中心',exact:true}).click();const center=page.getByRole('dialog',{name:'任务中心',exact:true});await center.getByText('正在打包并传送到浏览器',{exact:true}).waitFor();
  await center.getByLabel('任务知识库').selectOption(b.id);assert.equal(await center.locator('.task-row').count(),0);await center.getByLabel('任务知识库').selectOption(a.id);
  await page.screenshot({path:resolve('artifacts/v0924-export-streaming-desktop.png')});await page.setViewportSize({width:390,height:844});await page.screenshot({path:resolve('artifacts/v0924-export-streaming-mobile.png')});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  releaseOutput();const archive=await download.path();assert.equal(await download.failure(),null);assert.ok(archive);assert.equal(page.url(),base+'/');
  await center.getByText('服务器已传送完成；保存结果请查看浏览器下载列表',{exact:true}).waitFor();
  const extracted=await new Promise((resolveZip,reject)=>yauzl.open(archive,{lazyEntries:true},(error,zip)=>{
    if(error)return reject(error);let found=false;zip.on('error',reject);zip.on('end',()=>found?resolveZip(true):reject(Error('Missing exported video')));
    zip.on('entry',entry=>{if(!entry.fileName.endsWith('.mp4'))return zip.readEntry();zip.openReadStream(entry,(error,stream)=>{if(error)return reject(error);const actual=createHash('sha256');stream.on('data',chunk=>actual.update(chunk));stream.on('error',reject);stream.on('end',()=>{try{assert.equal(actual.digest('hex'),hash);found=true;zip.readEntry();}catch(e){reject(e);}});});});zip.readEntry();
  }));assert.ok(extracted);assert.deepEqual(errors,[]);
  // The same HTTP download works on a LAN address without secure-context file APIs.
  const lanAddress=Object.values(networkInterfaces()).flat().find(v=>!v.internal&&v.family==='IPv4'&&/^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(v.address))?.address;
  assert.ok(lanAddress,'A real LAN address is required for this verification');const lan='http://'+lanAddress+':'+server.address().port;
  assert.ok((await context.request.post(lan+'/api/auth/login',{data:{password:'0924'}})).ok());const lanPage=await context.newPage();await lanPage.goto(lan);assert.equal(await lanPage.evaluate(()=>isSecureContext),false);
  await lanPage.getByRole('button',{name:'导出',exact:true}).click();await lanPage.getByRole('button',{name:/JSON 元数据/}).click();const lanDownload=lanPage.waitForEvent('download');await lanPage.getByRole('button',{name:'下载导出文件',exact:true}).click();const metadata=JSON.parse(await readFile(await(await lanDownload).path(),'utf8'));assert.equal(metadata.items.length,1);assert.equal(metadata.items[0].id,item.id);
  console.log('PASS Edge: native streamed download survives page reload, visible server status and scope isolation, 8 MiB original hash matches, desktop/mobile layout, no export Blob buffering, actual insecure LAN download');
}finally{releaseOutput?.();await browser.close();await runtime.imports.stop();await runtime.backups.stop();await runtime.webhooks.stop();await runtime.trash.stop();await new Promise(r=>server.close(r));runtime.db.close();}
