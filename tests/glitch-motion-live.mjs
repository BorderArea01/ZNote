// Explicit current-instance acceptance; temporary token is removed in finally.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {mkdtemp,writeFile,copyFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {chromium} from 'playwright';
if(process.env.ZNOTE_MOTION_LIVE!=='1')throw Error('Set ZNOTE_MOTION_LIVE=1 for the local current-instance check.');
const dir=await mkdtemp(resolve('artifacts/glitch-motion-live-')),base='http://127.0.0.1:3741';
const db=new DatabaseSync('data/znote.sqlite'),id=randomUUID(),token='zn_'+randomBytes(32).toString('hex');
db.exec('PRAGMA busy_timeout=5000');
const hash=value=>createHash('sha256').update(value).digest('hex');
const state=()=>hash(JSON.stringify(db.prepare('SELECT id,version,updated_at,group_key,group_order FROM items ORDER BY id').all()));
const before=state(),pin=db.prepare("SELECT value FROM settings WHERE key='password'").get()?.value;
db.prepare('INSERT INTO tokens VALUES(?,?,?,?,?,?,?)').run(id,'主题动态临时验收',hash(token),'read','session',new Date().toISOString(),new Date(Date.now()+1200000).toISOString());
let browser;const report={checks:[]};
try{
 assert.equal((await(await fetch(base+'/api/health')).json()).status,'ok');
 browser=await chromium.launch({channel:'msedge',headless:true,args:['--disable-gpu']});
 for(const touch of [false,true]){
  const context=await browser.newContext({viewport:touch?{width:390,height:844}:{width:1440,height:980},isMobile:touch,hasTouch:touch,recordVideo:{dir:join(dir,'recordings'),size:touch?{width:390,height:844}:{width:1440,height:980}}});
  await context.addCookies([{name:'znote_session',value:token,url:base,httpOnly:true,sameSite:'Strict'}]);
  await context.addInitScript(()=>{if(!localStorage.getItem('znote-appearance'))localStorage.setItem('znote-appearance',JSON.stringify({style:'glitch',motion:'dynamic'}));localStorage.setItem('znote-theme','light');});
  const page=await context.newPage(),errors=[],writes=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(new URL(r.url()).origin===base&&new URL(r.url()).pathname.startsWith('/api/')&&!['GET','HEAD','OPTIONS'].includes(r.method()))writes.push({method:r.method(),path:new URL(r.url()).pathname});});
  await page.goto(base);await page.waitForFunction(()=>document.documentElement.dataset.glitchMotion==='running');
  const card=page.locator('.library-card').first();await card.waitFor();await page.waitForFunction(()=>document.querySelector('.library-card')?.hasAttribute('data-glitch-visible'));
  if(!touch)await page.mouse.move(8,8);
  const rects=()=>card.evaluate(el=>JSON.stringify([el.getBoundingClientRect().toJSON(),el.querySelector('h2').getBoundingClientRect().toJSON()]));
  await page.waitForFunction(()=>document.querySelector('.library-card > .signal-replay'));
  assert.equal(await card.locator('.signal-replay-copy').count(),2);
  assert.equal(await card.locator('.signal-replay :is(button,input,a,img,video,[id])').count(),0,'Decorative copies must not duplicate controls, IDs or media requests');
  assert.equal(await card.locator('.signal-replay').getAttribute('aria-hidden'),'true');
  await page.evaluate(()=>document.documentElement.dataset.theme='dark');
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('.library-card h2')).color===getComputedStyle(document.querySelector('.library-card .signal-replay-copy span')).color);
  await page.evaluate(()=>document.documentElement.dataset.theme='light');
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('.library-card h2')).color===getComputedStyle(document.querySelector('.library-card .signal-replay-copy span')).color);
  const bounds=await rects(),frames=new Set(),transforms=new Set(),slices=new Set();
  for(let n=0;n<10;n++){
    frames.add(hash(await card.screenshot({animations:'allow'})));
    transforms.add(await card.evaluate(e=>getComputedStyle(e,'::after').transform));
    slices.add(await card.locator('.signal-replay-copy').first().evaluate(e=>getComputedStyle(e).clipPath));
    assert.equal(await rects(),bounds,'Text and hit box moved during decoration');
    const overflow=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,viewport:document.documentElement.clientWidth,body:getComputedStyle(document.body).overflowX,main:getComputedStyle(document.querySelector('.main')).overflowX}));
    assert.ok(overflow.scroll<=overflow.viewport,'Flying fragments created horizontal scrolling: '+JSON.stringify(overflow));
    await page.waitForTimeout(180);
  }
  assert.ok(frames.size>1,'Rendered edge never changed over real elapsed time');assert.ok(transforms.size>1,'Ambient material never moved');
  assert.ok(slices.size>1,'Content copies never changed their clipped horizontal slices');
  await page.screenshot({path:join(dir,touch?'touch-dynamic.png':'desktop-dynamic.png'),animations:'allow'});
  await page.waitForTimeout(4500);
  // Make a genuine offscreen scroll without creating or editing user records.
  await page.evaluate(()=>{const spacer=document.createElement('div');spacer.id='motion-scroll-fixture';spacer.style.height='2200px';document.body.append(spacer);window.scrollTo(0,document.documentElement.scrollHeight);});
  await page.waitForFunction(()=>!document.querySelector('.library-card').hasAttribute('data-glitch-visible'));
  assert.equal(await card.evaluate(e=>getComputedStyle(e,'::after').animationName),'none');
  await page.evaluate(()=>{document.querySelector('#motion-scroll-fixture').remove();window.scrollTo(0,0);});
  await page.waitForFunction(()=>document.querySelector('.library-card')?.hasAttribute('data-glitch-visible'));
  const act=touch?'tap':'click';
  await page.getByRole('button',{name:'个人设置',exact:true})[act]();
  const group=page.getByRole('group',{name:'主题动效',exact:true});await group.getByRole('button',{name:'静态',exact:true})[act]();
  await page.waitForFunction(()=>document.documentElement.dataset.glitchMotion==='still');await page.keyboard.press('Escape');
  const still=hash(await card.screenshot());await page.waitForTimeout(650);assert.equal(hash(await card.screenshot()),still,'Static setting kept animating');
  assert.equal(await card.locator('.signal-replay').count(),0,'Static mode must release replicated content');
  await page.reload();assert.equal(await page.locator('html').getAttribute('data-motion'),'still');
  await page.getByRole('button',{name:'个人设置',exact:true})[act]();await page.getByRole('group',{name:'主题动效',exact:true}).getByRole('button',{name:'动态',exact:true})[act]();await page.keyboard.press('Escape');
  await page.waitForFunction(()=>document.documentElement.dataset.glitchMotion==='running');
  await page.emulateMedia({reducedMotion:'reduce'});await page.waitForFunction(()=>document.documentElement.dataset.glitchMotion==='still');assert.equal(await card.evaluate(e=>getComputedStyle(e,'::after').animationName),'none');
  await page.emulateMedia({reducedMotion:'no-preference'});await page.waitForFunction(()=>document.documentElement.dataset.glitchMotion==='running');
  const primary=page.locator('.heading-actions .primary:visible').first();await primary[act]();assert.equal(await primary.evaluate(e=>e.hasAttribute('data-glitch-pulse')),true);assert.match(await primary.evaluate(e=>getComputedStyle(e,'::before').animationName),/signal-impact/);await page.keyboard.press('Escape');
  await page.waitForTimeout(500);assert.equal(await primary.evaluate(e=>e.hasAttribute('data-glitch-pulse')),false);
  // A changing label and a resize must update the visual copy without a
  // MutationObserver feedback loop. DOM-only fixture; no library API writes.
  await page.evaluate(()=>{const el=document.createElement('button');el.id='motion-label-fixture';el.className='signal-button';el.textContent='等待采集';Object.assign(el.style,{position:'fixed',bottom:'20px',left:'20px',width:'160px',height:'42px',zIndex:9999});document.body.append(el);});
  const fixture=page.locator('#motion-label-fixture');await fixture.locator('.signal-replay').waitFor({state:'attached'});
  await fixture.evaluate(el=>{el.firstChild.textContent='保存成功';el.style.width='180px';});
  await page.waitForFunction(()=>{const el=document.querySelector('#motion-label-fixture');return el.querySelector('.signal-replay-copy span')?.textContent==='保存成功'&&el.querySelector('.signal-replay-copy span')?.style.width===el.clientWidth+'px';});
  await fixture.evaluate(el=>el.remove());
  const other=await context.newPage();await other.goto('about:blank');await other.bringToFront();await page.waitForTimeout(200);const hidden=await page.evaluate(()=>document.hidden);if(hidden)assert.equal(await page.locator('html').getAttribute('data-glitch-motion'),'still');await other.close();await page.bringToFront();
  await page.route('**/themes/glitch/motion.js*',route=>route.abort());await page.reload();await card.waitFor();assert.equal(await card.evaluate(e=>getComputedStyle(e,'::after').animationName),'none');
  await page.unroute('**/themes/glitch/motion.js*');await page.reload();await page.waitForFunction(()=>document.documentElement.dataset.glitchMotion==='running');
  assert.deepEqual(errors,[]);assert.deepEqual(writes,[],'Motion acceptance must not write to the live API');const video=page.video();await context.close();await copyFile(await video.path(),join(dir,touch?'touch.webm':'desktop.webm'));
  report.checks.push({touch,renderedFrames:frames.size,contentSlices:slices.size,materialTransforms:transforms.size,replicasAccessibleHidden:true,liveLabelAndResize:true,textAndHitBoxesStable:true,offscreenStopped:true,staticAndReload:true,systemReducedMotion:true,realInputPulse:true,scriptFailureAndRecovery:true,realBackgroundVisibility:hidden});
 }
 report.originalItemsUnchanged=before===state();report.noApiWrites=true;report.readOnlyScope=true;report.currentServiceVerified=true;console.log(JSON.stringify(report));
}finally{await browser?.close();assert.equal(db.prepare("SELECT value FROM settings WHERE key='password'").get()?.value,pin);db.prepare('DELETE FROM tokens WHERE id=?').run(id);db.close();await writeFile(join(dir,'result.json'),JSON.stringify(report,null,2));console.log('Evidence '+dir);}
