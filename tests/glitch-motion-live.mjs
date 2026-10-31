// Current-instance acceptance. No library writes; temporary read token removed.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {chromium} from 'playwright';
if(process.env.ZNOTE_MOTION_LIVE!=='1')throw Error('Set ZNOTE_MOTION_LIVE=1 for local acceptance');
const dir=await mkdtemp(resolve('artifacts/glitch-hover-live-')),base='http://127.0.0.1:3741';
const db=new DatabaseSync('data/znote.sqlite'),id=randomUUID(),token='zn_'+randomBytes(32).toString('hex'),hash=v=>createHash('sha256').update(v).digest('hex');db.exec('PRAGMA busy_timeout=5000');
const state=()=>hash(JSON.stringify(db.prepare('SELECT id,version,updated_at,group_key,group_order FROM items ORDER BY id').all())),before=state(),pin=db.prepare("SELECT value FROM settings WHERE key='password'").get()?.value;
db.prepare('INSERT INTO tokens VALUES(?,?,?,?,?,?,?)').run(id,'悬停单次动效只读验收',hash(token),'read','session',new Date().toISOString(),new Date(Date.now()+1200000).toISOString());
let browser;const report={checks:[]};
try{
 assert.equal((await(await fetch(base+'/api/health')).json()).status,'ok');
 browser=await chromium.launch({channel:'msedge',headless:true});
 for(const touch of [false,true]){
  const context=await browser.newContext({viewport:touch?{width:390,height:844}:{width:1440,height:980},isMobile:touch,hasTouch:touch});await context.addCookies([{name:'znote_session',value:token,url:base,httpOnly:true,sameSite:'Strict'}]);
  await context.addInitScript(()=>{if(!localStorage.getItem('znote-appearance'))localStorage.setItem('znote-appearance',JSON.stringify({style:'glitch',motion:'dynamic'}));localStorage.setItem('znote-theme','light');});
  const page=await context.newPage(),errors=[],writes=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(new URL(r.url()).origin===base&&new URL(r.url()).pathname.startsWith('/api/')&&!['GET','HEAD','OPTIONS'].includes(r.method()))writes.push(r.method());});
  await page.goto(base);await page.waitForFunction(()=>document.documentElement.dataset.glitchMotion==='running');await page.mouse.move(2,2);
  const card=page.locator('.library-card').first();await card.waitFor();await page.waitForTimeout(800);
  assert.equal(await page.locator('.signal-shards,.signal-replay,[data-glitch-pulse]').count(),0,'Idle must allocate no glitch fragments');
  assert.equal(await card.evaluate(e=>getComputedStyle(e,'::before').opacity),'0');assert.equal(await card.evaluate(e=>getComputedStyle(e,'::before').maskImage),'none');assert.notEqual(await card.evaluate(e=>getComputedStyle(e).backgroundColor),'rgba(0, 0, 0, 0)');
  const idle=hash(await card.screenshot());await page.waitForTimeout(500);assert.equal(hash(await card.screenshot()),idle,'Idle image changed without interaction');
  await page.screenshot({path:join(dir,touch?'touch-idle.png':'desktop-idle.png')});
  const box=await card.boundingBox();let samples=0;
  if(!touch){
   await page.evaluate(()=>{window.glitchSamples=new Promise(resolve=>{const frames=[];const begin=performance.now();function frame(t){const copy=document.querySelector('.library-card .signal-replay-copy');if(copy)frames.push({t,transform:getComputedStyle(copy).transform,clip:getComputedStyle(copy).clipPath});if(t-begin<850)requestAnimationFrame(frame);else resolve(frames);}requestAnimationFrame(frame);});});
   await card.hover();await page.waitForFunction(()=>document.querySelector('.library-card').hasAttribute('data-glitch-pulse'));await page.waitForTimeout(80);await page.screenshot({path:join(dir,'desktop-hover.png'),animations:'allow'});
   const frames=await page.evaluate(()=>window.glitchSamples);samples=new Set(frames.map(f=>f.transform)).size;assert.ok(samples>=12,'Not enough continuously interpolated frames: '+samples);
   assert.deepEqual(await card.boundingBox(),box,'Hit bounds moved');assert.equal(await page.locator('[data-glitch-pulse]').count(),0);await page.waitForTimeout(650);assert.equal(await page.locator('.signal-replay').count(),0,'Staying hovered repeated the burst');
   await card.locator('h2').hover();assert.equal(await card.getAttribute('data-glitch-pulse'),null,'Crossing descendants retriggered hover');await page.mouse.move(2,2);await card.hover();assert.notEqual(await card.getAttribute('data-glitch-pulse'),null,'Re-entry failed');await page.mouse.move(2,2);await page.waitForTimeout(720);
  }
  // DOM-only button exercises touch/keyboard, text resize and recovery without
  // submitting a capture or modifying the user's library.
  await page.evaluate(()=>{const b=document.createElement('button');b.id='motion-label-fixture';b.className='signal-button';b.textContent='等待采集';Object.assign(b.style,{position:'fixed',bottom:'12px',left:'12px',width:'160px',height:'42px',zIndex:9999});document.body.append(b);});
  const fixture=page.locator('#motion-label-fixture');if(touch)await fixture.tap();else{await fixture.focus();await page.keyboard.press(' ');}await fixture.locator('.signal-replay').waitFor({state:'attached'});
  assert.equal(await fixture.locator('.signal-replay :is(button,input,a,img,video,[id])').count(),0);assert.equal(await fixture.locator('.signal-replay').getAttribute('aria-hidden'),'true');
  await fixture.evaluate(el=>{el.firstChild.textContent='保存成功';el.style.width='180px';});await page.waitForFunction(()=>{const e=document.querySelector('#motion-label-fixture');return e.querySelector('.signal-replay-copy span')?.textContent==='保存成功'&&e.querySelector('.signal-replay-copy span')?.style.width===e.clientWidth+'px';});await page.waitForTimeout(720);assert.equal(await fixture.locator('.signal-replay').count(),0);
  const act=touch?'tap':'click';await page.getByRole('button',{name:'个人设置',exact:true})[act]();await page.getByRole('group',{name:'主题动效',exact:true}).getByRole('button',{name:'静态',exact:true})[act]();await page.keyboard.press('Escape');await page.waitForFunction(()=>document.documentElement.dataset.glitchMotion==='still');if(touch)await fixture.tap();else await fixture.hover();assert.equal(await fixture.getAttribute('data-glitch-pulse'),null);
  await page.reload();assert.equal(await page.locator('html').getAttribute('data-motion'),'still');await page.getByRole('button',{name:'个人设置',exact:true})[act]();await page.getByRole('group',{name:'主题动效',exact:true}).getByRole('button',{name:'动态',exact:true})[act]();await page.keyboard.press('Escape');await page.waitForFunction(()=>document.documentElement.dataset.glitchMotion==='running');
  await page.emulateMedia({reducedMotion:'reduce'});await page.waitForFunction(()=>document.documentElement.dataset.glitchMotion==='still');if(!touch)await card.hover();assert.equal(await card.getAttribute('data-glitch-pulse'),null);await page.emulateMedia({reducedMotion:'no-preference'});await page.waitForFunction(()=>document.documentElement.dataset.glitchMotion==='running');
  const primary=page.locator('.heading-actions .primary:visible').first();await primary[act]();await page.keyboard.press('Escape');await page.waitForTimeout(720);
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth);assert.ok(overflow,'Fragment widened the viewport');
  await page.route('**/themes/glitch/motion.js*',r=>r.abort());await page.reload();await card.waitFor();if(!touch)await card.hover();assert.equal(await card.getAttribute('data-glitch-pulse'),null);assert.equal(await card.evaluate(e=>getComputedStyle(e,'::before').opacity),'0');await page.unroute('**/themes/glitch/motion.js*');await page.reload();await page.waitForFunction(()=>document.documentElement.dataset.glitchMotion==='running');
  if(!touch){await card.hover();assert.notEqual(await card.getAttribute('data-glitch-pulse'),null);await page.evaluate(()=>{const s=document.createElement('div');s.id='scroll-fixture';s.style.height='2200px';document.body.append(s);scrollTo(0,document.documentElement.scrollHeight);});await page.waitForFunction(()=>!document.querySelector('.library-card').hasAttribute('data-glitch-pulse'));await page.evaluate(()=>{document.querySelector('#scroll-fixture').remove();scrollTo(0,0);});}
  assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);report.checks.push({touch,idleCleanAndStable:true,continuousTransformSamples:samples,oneShotHover:!touch,touchOrKeyboard:true,labelResize:true,staticReload:true,reducedMotion:true,uiClose:true,viewportBounded:true,scriptFailureRecovery:true});await context.close();
 }
 report.originalItemsUnchanged=before===state();report.noApiWrites=true;report.readOnlyScope=true;console.log(JSON.stringify(report));
}finally{await browser?.close();assert.equal(db.prepare("SELECT value FROM settings WHERE key='password'").get()?.value,pin);db.prepare('DELETE FROM tokens WHERE id=?').run(id);db.close();await writeFile(join(dir,'result.json'),JSON.stringify(report,null,2));console.log('Evidence '+dir);}
