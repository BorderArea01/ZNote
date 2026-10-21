import assert from 'node:assert/strict';import {chromium} from 'playwright';import {mkdtemp,writeFile,readFile} from 'node:fs/promises';import {resolve,join} from 'node:path';
import worker from '../addons/connectors/cloudflare/worker.js';import {inboxFixture} from './helpers/cloudflare-inbox-fixture.js';import {jsonClient} from '../addons/connectors/cloudflare/collector.js';
const live=process.argv.includes('--live'),dir=await mkdtemp(resolve('artifacts/cloudflare-import-ui-')),fixture=live?null:await inboxFixture();let browser;
const config=live?JSON.parse(await readFile('data/cloudflare-collector/config.json','utf8')):null;
const origin=live?config.relay_origin:'https://inbox.example';
const connector=live?jsonClient(origin,config.connector_secret,{remote:true}):async(path,method,data)=>{const r=await fixture.connector(path.slice('/connector/'.length),data);assert.ok(r.ok);return r.json();};
const result={live,origin,paths:[]};
try{for(const touch of [false,true]){
 const code=crypto.randomUUID();await connector('/connector/pair','POST',{code});
 browser=await chromium.launch({channel:'msedge',headless:true,args:['--disable-gpu','--renderer-process-limit=2'],...(live?{proxy:{server:'http://127.0.0.1:7897'}}:{})});
 const context=await browser.newContext({hasTouch:touch,viewport:touch?{width:390,height:844}:{width:1100,height:850}}),page=await context.newPage(),requests=[];
 await context.addInitScript(()=>{Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{if(window.__clipboardFail)throw Error('Clipboard denied');window.__copied=value;}}});});
 if(!live)await context.route(origin+'/**',async route=>{const r=route.request(),response=await worker.fetch(new Request(r.url(),{method:r.method(),headers:r.headers(),...(r.postDataBuffer()?{body:r.postDataBuffer()}:{})}),fixture.env);await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});});
 page.on('request',r=>requests.push({url:r.url(),method:r.method(),referer:r.headers().referer||''}));
 let authenticated=false;try{
  await page.goto(origin+'/connect#code='+code);await page.getByRole('link',{name:'导入 ZNote App',exact:true}).waitFor();
  const complete=origin+'/connect/'+code;assert.equal(page.url(),complete);
  await page.reload();await page.getByRole('link',{name:'导入 ZNote App',exact:true}).waitFor();assert.equal(page.url(),complete);
  await page.goto(complete);await page.getByRole('link',{name:'导入 ZNote App',exact:true}).waitFor();
  const reopened=await context.newPage();await reopened.goto(complete);await reopened.getByRole('link',{name:'导入 ZNote App',exact:true}).waitFor();await reopened.close();
  if(process.argv.includes('--with-update'))await page.waitForFunction(()=>document.getElementById('update').getAttribute('href').startsWith('/downloads/'));
  assert.equal(new URL(page.url()).hash,'');assert.ok(requests.every(r=>r.url.startsWith(origin)&&!r.referer.includes(code)),'invitation must not leak to third parties or Referer');assert.ok(requests.every(r=>r.method==='GET'),'link preview/reload must not redeem the invitation');
  const href=await page.locator('#import').getAttribute('href');assert.ok(href.startsWith('intent://connect?'));assert.ok(href.endsWith('#Intent;scheme=znote;package=io.github.borderarea01.znote;end'));
  const query=new URLSearchParams(href.split('?')[1].split('#')[0]);assert.equal(query.get('server'),origin);assert.equal(query.get('code'),code);
  const dims=await page.evaluate(()=>({w:innerWidth,scroll:document.documentElement.scrollWidth}));assert.ok(dims.scroll<=dims.w);
  const click=locator=>touch?locator.tap():locator.click();await page.evaluate(()=>window.__clipboardFail=true);await click(page.getByRole('button',{name:'复制备用配置'}));await page.getByRole('status').filter({hasText:'浏览器未允许复制'}).waitFor();
  await page.evaluate(()=>window.__clipboardFail=false);await click(page.getByRole('button',{name:'复制备用配置'}));const copied=await page.evaluate(()=>window.__copied);const native=new URL(copied);assert.equal(native.protocol,'znote:');assert.equal(native.searchParams.get('server'),origin);assert.equal(native.searchParams.get('code'),code);
  await page.screenshot({path:join(dir,(touch?'touch':'desktop')+'-invite.png'),fullPage:true});
  const button=page.getByRole('button',{name:'用网页采集'});if(touch)await button.tap();else await button.click();
  await page.locator('#workspace').waitFor();authenticated=true;
  const device=await page.evaluate(async()=>{const r=await fetch('/api/tokens',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scope:'write',name:'临时导入协议验收'})});return r.json();});assert.match(device.token,/^zn_[a-f0-9]{64}$/);
  await page.evaluate(async token=>{const r=await fetch('/api/collections',{headers:{Authorization:'Bearer '+token}});if(!r.ok)throw Error('device authorization failed');await fetch('/api/auth/logout',{method:'POST',headers:{Authorization:'Bearer '+token}});},device.token);
  await page.evaluate(()=>fetch('/api/auth/logout',{method:'POST'}));authenticated=false;
  await page.goto(complete);await page.getByRole('button',{name:'用网页采集'}).click();await page.getByRole('status').filter({hasText:'连接码无效或已使用'}).waitFor();
  await page.goto(origin+'/connect');await page.getByRole('status').filter({hasText:'这里没有连接信息'}).waitFor();assert.equal(await page.locator('#import').isVisible(),false);
  await page.locator('#invitation-input').fill('https://evil.example/connect/'+code);await click(page.getByRole('button',{name:'打开邀请',exact:true}));await page.getByRole('status').filter({hasText:'请粘贴完整'}).waitFor();assert.equal(page.url(),origin+'/connect');
  await page.locator('#invitation-input').fill(complete);await page.locator('#invitation-input').press('Enter');await page.getByRole('link',{name:'导入 ZNote App',exact:true}).waitFor();assert.equal(page.url(),complete);
  result.paths.push({touch,legacyLinkUpgrade:true,reload:true,reopen:true,noPreviewRedemption:true,noThirdPartyOrReferrerLeak:true,explicitAndroidIntent:true,nativeClipboardFallback:true,clipboardFailureRecovery:true,browserImport:true,nativeToken:true,consumedInvite:true,missingCodeRecovery:true,noOverflow:true});
 }finally{if(authenticated)await page.evaluate(()=>fetch('/api/auth/logout',{method:'POST'})).catch(()=>{});await browser.close();browser=null;}
}}finally{await browser?.close();fixture?.sql.close();await writeFile(join(dir,'result.json'),JSON.stringify(result,null,2));console.log('Evidence '+dir);}
