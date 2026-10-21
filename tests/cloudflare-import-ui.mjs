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
 if(!live)await context.route(origin+'/**',async route=>{const r=route.request(),response=await worker.fetch(new Request(r.url(),{method:r.method(),headers:r.headers(),...(r.postDataBuffer()?{body:r.postDataBuffer()}:{})}),fixture.env);await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});});
 page.on('request',r=>requests.push(r.url()));
 let authenticated=false;try{
  await page.goto(origin+'/connect#code='+code);await page.getByRole('link',{name:'导入 ZNote App',exact:true}).waitFor();
  if(process.argv.includes('--with-update'))await page.waitForFunction(()=>document.getElementById('update').getAttribute('href').startsWith('/downloads/'));
  assert.equal(new URL(page.url()).hash,'');assert.ok(requests.every(url=>!url.includes(code)),'invitation must not enter HTTP URLs');
  const href=await page.locator('#import').getAttribute('href');assert.ok(href.startsWith('intent://connect?'));assert.ok(href.endsWith('#Intent;scheme=znote;package=io.github.borderarea01.znote;end'));
  const query=new URLSearchParams(href.split('?')[1].split('#')[0]);assert.equal(query.get('server'),origin);assert.equal(query.get('code'),code);
  const dims=await page.evaluate(()=>({w:innerWidth,scroll:document.documentElement.scrollWidth}));assert.ok(dims.scroll<=dims.w);
  await page.screenshot({path:join(dir,(touch?'touch':'desktop')+'-invite.png'),fullPage:true});
  const button=page.getByRole('button',{name:'暂用浏览器采集'});if(touch)await button.tap();else await button.click();
  await page.locator('#workspace').waitFor();authenticated=true;
  const device=await page.evaluate(async()=>{const r=await fetch('/api/tokens',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scope:'write',name:'临时导入协议验收'})});return r.json();});assert.match(device.token,/^zn_[a-f0-9]{64}$/);
  await page.evaluate(async token=>{const r=await fetch('/api/collections',{headers:{Authorization:'Bearer '+token}});if(!r.ok)throw Error('device authorization failed');await fetch('/api/auth/logout',{method:'POST',headers:{Authorization:'Bearer '+token}});},device.token);
  await page.evaluate(()=>fetch('/api/auth/logout',{method:'POST'}));authenticated=false;
  await page.goto(origin+'/connect#code='+code);await page.getByRole('button',{name:'暂用浏览器采集'}).click();await page.getByRole('status').filter({hasText:'连接码无效或已使用'}).waitFor();
  await page.goto(origin+'/connect');await page.getByRole('status').filter({hasText:'邀请不完整'}).waitFor();assert.equal(await page.locator('#import').isVisible(),false);
  result.paths.push({touch,secretNotInRequests:true,explicitAndroidIntent:true,browserImport:true,nativeToken:true,consumedInvite:true,missingCodeRecovery:true,noOverflow:true});
 }finally{if(authenticated)await page.evaluate(()=>fetch('/api/auth/logout',{method:'POST'})).catch(()=>{});await browser.close();browser=null;}
}}finally{await browser?.close();fixture?.sql.close();await writeFile(join(dir,'result.json'),JSON.stringify(result,null,2));console.log('Evidence '+dir);}
