import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';
import {resolve,join} from 'node:path';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {createApp} from '../server/app.js';
const data=await mkdtemp(resolve('artifacts/desktop-appearance-'));
const runtime=createApp({dataDir:join(data,'library'),staticDir:resolve('artifacts/build-glitch')});
const server=runtime.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
const launch=()=>electron.launch({executablePath:process.env.ZNOTE_DESKTOP_EXE||resolve('clients/desktop/node_modules/electron/dist/electron.exe'),args:process.env.ZNOTE_DESKTOP_EXE?[]:[resolve('clients/desktop')],env:{...process.env,ZNOTE_DESKTOP_TEST_DATA:join(data,'client'),ZNOTE_DESKTOP_HEADLESS:'0'},timeout:30000});
let app;const report={packagedExecutable:process.env.ZNOTE_DESKTOP_EXE||null};
try{
 app=await launch();const launcher=await app.firstWindow(),policyErrors=[];launcher.on('console',m=>{if(/Refused|Content Security Policy/i.test(m.text()))policyErrors.push(m.text());});await launcher.locator('#version').filter({hasText:'beta.28'}).waitFor();
 await app.evaluate(({BrowserWindow,Tray})=>{global.__appearanceCalls={window:[],tray:[]};for(const [type,proto,key]of[['window',BrowserWindow.prototype,'setIcon'],['tray',Tray.prototype,'setImage']]){const original=proto[key];proto[key]=function(icon){global.__appearanceCalls[type].push(icon.toDataURL());return original.call(this,icon);};}});
 await launcher.locator('.appearance summary').click();await launcher.locator('#style').selectOption('glitch');await launcher.locator('html[data-style=glitch]').waitFor();
 for(const mode of['light','dark']){await launcher.locator('#mode').selectOption(mode);await launcher.waitForFunction(m=>document.documentElement.dataset.mode===m,mode);await launcher.waitForFunction(()=>getComputedStyle(document.querySelector('section'),'::before').maskImage.includes('data:image/svg+xml'));assert.deepEqual(policyErrors,[],'local material masks must pass CSP');await launcher.screenshot({path:join(data,'launcher-'+mode+'.png')});}
 await launcher.locator('#address').fill(base);const next=app.waitForEvent('window',{predicate:p=>!p.url().startsWith('file:')});await launcher.locator('#connect button').click();const page=await next;
 await page.getByLabel('访问密码').fill('0427');await page.getByRole('button',{name:'开始使用 ZNote'}).click();await page.getByRole('button',{name:'个人设置',exact:true}).waitFor();
 assert.equal(await page.locator('html').getAttribute('data-style'),'glitch');assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');assert.equal(await page.evaluate(()=>typeof require),'undefined');assert.equal(await page.evaluate(()=>typeof window.znoteLauncher),'undefined');
 await page.evaluate(()=>{window.__draft='未保存的草稿';window.__nativeChanges=0;window.addEventListener('znote:native-appearance',()=>window.__nativeChanges++);});
 await page.getByRole('button',{name:'个人设置',exact:true}).click();await page.getByRole('button',{name:'浅色',exact:true}).click();await page.getByRole('button',{name:'风格：简约',exact:true}).click();await page.waitForFunction(()=>JSON.parse(window.ZNoteAppearance.snapshot()).style==='minimal');
 const saved=JSON.parse(await readFile(join(data,'client/connection.json'),'utf8'));assert.equal(saved.address,base);assert.equal(saved.appearance.style,'minimal');assert.equal(saved.appearance.mode,'light');assert.equal(await page.evaluate(()=>window.__draft),'未保存的草稿');
 const before=await page.evaluate(()=>window.__nativeChanges);await page.waitForTimeout(700);assert.equal(await page.evaluate(()=>window.__nativeChanges),before,'no repeated bridge loop');
 await launcher.locator('#style').selectOption('glitch');await page.waitForFunction(()=>document.documentElement.dataset.style==='glitch');await page.keyboard.press('Escape');await page.screenshot({path:join(data,'library-light.png')});
 const calls=await app.evaluate(()=>global.__appearanceCalls);assert.ok(calls.tray.length>=3);assert.ok(new Set(calls.tray).size>=2);assert.ok(calls.window.length>=3);report.nativeWindowAndTrayIcons=true;
 await app.close();app=await launch();const restarted=await app.firstWindow();await restarted.locator('html[data-style=glitch]').waitFor();assert.equal(await restarted.locator('#address').inputValue(),base);assert.equal(await restarted.locator('#mode').inputValue(),'light');report.restartAndConnectionPreserved=true;report.sandbox=true;report.bidirectionalBridgeWithoutReload=true;report.version='0.10.0-beta.28';console.log('PASS desktop appearance: launcher, light/dark, window/tray icons, sandbox, web bridge without reload, classic restoration and restart/connection persistence');
}catch(error){for(const [i,p]of(app?.windows()||[]).entries())await p.screenshot({path:join(data,'failure-'+i+'.png')}).catch(()=>{});throw error;}
finally{await app?.close().catch(()=>{});await new Promise(r=>server.close(r));for(const key of['captures','weixin','trash','imports','backups','webhooks'])await runtime[key].stop();runtime.db.close();await writeFile(join(data,'result.json'),JSON.stringify(report,null,2));console.log('Evidence '+data);}
