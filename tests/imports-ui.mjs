import { chromium } from 'playwright';
import { createApp } from '../server/app.js';
import { mkdtemp, copyFile, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
const dir=await mkdtemp(resolve('artifacts/import-ui-'));
const runtime=createApp({dataDir:dir,staticDir:resolve('artifacts/build-v05'),importOptions:{downloader:async({dir,url,signal})=>{
  for(let i=0;i<10;i++){if(signal.aborted)throw new Error('cancelled');await new Promise(r=>setTimeout(r,80));}
  if(url.includes('/999'))throw Object.assign(new Error('平台要求登录或验证'),{status:422});
  const path=join(dir,'media.mp4');await copyFile('tests/fixtures/sample.mp4',path);return{path,originalname:'video.mp4',title:'网络采集验证',description:'保留的原始说明'};
}}});
const server=runtime.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({channel:'msedge',headless:true});const context=await browser.newContext({viewport:{width:1440,height:1000}});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
  await page.goto(base);await page.getByLabel('访问密码').fill('0382');await page.getByRole('button',{name:'开始使用 ZNote'}).click();
  await page.getByRole('button',{name:'网络采集',exact:true}).click();await page.getByLabel('视频页面链接').fill('https://x.com/test/status/123');await page.getByLabel('标签（用逗号分隔）').fill('参考,视频');await page.getByRole('button',{name:'开始采集',exact:true}).click();
  await page.getByRole('button',{name:'打开视频',exact:true}).waitFor();
  await page.screenshot({path:resolve('artifacts/v05-import-desktop.png')});
  await page.getByRole('button',{name:'打开视频',exact:true}).click();await page.locator('video').waitFor();await page.waitForFunction(()=>document.querySelector('video')?.readyState>=2);
  assert.match(await page.getByLabel('视频说明').inputValue(),/来源链接：https:\/\/x.com\/test\/status\/123/);
  await page.locator('video').evaluate(async el=>{el.muted=true;await el.play();});await page.waitForFunction(()=>document.querySelector('video')?.currentTime>.2);await page.locator('video').evaluate(el=>el.pause());
  await page.getByRole('button',{name:'关闭窗口'}).click();await page.getByRole('button',{name:'网络采集',exact:true}).click();
  await page.getByLabel('视频页面链接').fill('https://x.com/test/status/999');await page.getByRole('button',{name:'开始采集',exact:true}).click();await page.getByText('平台要求登录或验证',{exact:true}).waitFor();await page.getByRole('button',{name:'重新填写此链接'}).click();assert.equal(await page.getByLabel('视频页面链接').inputValue(),'https://x.com/test/status/999');
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:resolve('artifacts/v05-import-mobile.png')});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.deepEqual(errors,[]);console.log('PASS: import UI, job progress, source remarks, actual playback, error retry, mobile overflow');
}catch(e){await page.screenshot({path:resolve('artifacts/v05-import-failure.png')});throw e;}
finally{await browser.close();await runtime.imports.stop();await runtime.backups.stop();await runtime.webhooks.stop();await new Promise(r=>server.close(r));runtime.db.close();}
