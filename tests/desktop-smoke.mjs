import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';
import {resolve,join} from 'node:path';
import {mkdir,mkdtemp,readFile} from 'node:fs/promises';
import sharp from 'sharp';
await mkdir('artifacts',{recursive:true});
const data=await mkdtemp(resolve('artifacts/desktop-smoke-'));
const exe=process.env.ZNOTE_DESKTOP_EXE||resolve('clients/desktop/node_modules/electron/dist',process.platform==='win32'?'electron.exe':process.platform==='darwin'?'Electron.app/Contents/MacOS/Electron':'electron');
const launch=()=>electron.launch({executablePath:exe,args:process.env.ZNOTE_DESKTOP_EXE?[]:[resolve('clients/desktop')],env:{...process.env,ZNOTE_DESKTOP_TEST_DATA:data,ZNOTE_DESKTOP_HEADLESS:process.env.CI?'0':'1'},timeout:60000});
let app=await launch(),origin;
try{
 const launcher=await app.firstWindow();await launcher.locator('#local').waitFor();await launcher.screenshot({path:join(data,'launcher.png')});
 await launcher.locator('#address').fill('http://example.com');await launcher.locator('#connect button').click();await launcher.getByRole('status').filter({hasText:'HTTPS'}).waitFor();
 const next=app.waitForEvent('window',p=>!p.url().startsWith('file:'));await launcher.locator('#local').click();const page=await next;
 await page.getByLabel('访问密码').waitFor();origin=new URL(page.url()).origin;
 assert.equal(await page.evaluate(()=>typeof require),'undefined');assert.equal(await page.evaluate(()=>typeof window.znoteLauncher),'undefined');
 await page.getByLabel('访问密码').fill('0427');await page.getByRole('button',{name:'开始使用 ZNote'}).click();await page.getByRole('heading',{name:/我的知识库/}).waitFor();
 const image=await sharp({create:{width:300,height:200,channels:3,background:'#6f70a8'}}).png().toBuffer();
 await page.locator('input[type=file]').first().setInputFiles({name:'client-test.png',mimeType:'image/png',buffer:image});await page.getByRole('button',{name:'开始上传',exact:true}).click();await page.getByRole('button',{name:'完成',exact:true}).click();await page.getByRole('button',{name:'全部内容 1',exact:true}).click();await page.getByRole('button',{name:'打开 client-test.png',exact:true}).waitFor();
 const items=await page.evaluate(async()=>{const r=await fetch('/api/items');return r.json()});assert.ok(JSON.stringify(items).includes('client-test.png'));
 await page.screenshot({path:join(data,'library.png')});
 // Cancelling an unsaved-edit close must keep the managed service alive.
 page.on('dialog',()=>{});await app.evaluate(({dialog})=>{dialog.showMessageBoxSync=()=>0});await page.evaluate(()=>{window.onbeforeunload=()=>false});await app.evaluate(({app})=>app.quit());await new Promise(r=>setTimeout(r,500));assert.equal((await fetch(origin+'/api/health')).status,200);assert.equal(page.isClosed(),false);await page.evaluate(()=>{window.onbeforeunload=null});
 await page.evaluate(async()=>{await navigator.serviceWorker.register('/sw.js');await Promise.race([navigator.serviceWorker.ready,new Promise((_,reject)=>setTimeout(()=>reject(Error('service worker readiness timeout')),15000))])});const cached=await page.evaluate(async()=>{const values=[];for(const key of await caches.keys())for(const r of await(await caches.open(key)).keys())values.push(new URL(r.url).pathname);return values});assert.deepEqual(cached,['/offline.html']);
 await app.close();await assert.rejects(fetch(origin+'/api/health',{signal:AbortSignal.timeout(1000)}));
 app=await launch();const launch2=await app.firstWindow();assert.equal(await launch2.locator('#address').inputValue(),origin);const next2=app.waitForEvent('window',p=>!p.url().startsWith('file:'));await launch2.locator('#local').click();const page2=await next2;
 await Promise.race([page2.getByLabel('访问密码').waitFor(),page2.getByRole('heading',{name:/我的知识库/}).waitFor()]);if(await page2.getByLabel('访问密码').isVisible()){await page2.getByLabel('访问密码').fill('0427');await page2.getByRole('button',{name:'进入知识库'}).click();}await page2.getByRole('button',{name:'全部内容 1',exact:true}).click();await page2.getByRole('button',{name:'打开 client-test.png',exact:true}).waitFor();
 console.log('PASS desktop: invalid connection, sandbox, local startup, password, image upload, public-only offline cache, graceful quit, restart persistence. Evidence: '+data);
}catch(e){for(const [i,p] of app.windows().entries()){await p.screenshot({path:join(data,'failure-'+i+'.png')}).catch(()=>{});}throw e}finally{await app.close().catch(()=>{})}
