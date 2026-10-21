import assert from 'node:assert/strict';
import http from 'node:http';
import {chromium} from 'playwright';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';

const live=process.argv.includes('--live'),root=resolve('docs/design/overlay-ui');
const dir=await mkdtemp(resolve('artifacts/overlay-design-preview-'));
const files={'index.html':'text/html; charset=utf-8','styles.css':'text/css; charset=utf-8','app.js':'text/javascript; charset=utf-8'};
let browser,server;
if(!live){
 server=http.createServer(async(req,res)=>{const name=new URL(req.url,'http://localhost').pathname.split('/').pop()||'index.html';if(!files[name]){res.writeHead(404).end();return;}res.setHeader('Content-Type',files[name]);res.end(await readFile(join(root,name)));});
 server.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
}
const url=live?'https://znote-capture-inbox.pages.dev/design/overlay-ui/':'http://127.0.0.1:'+server.address().port+'/';
const result={live,url,paths:[]};
try{
 for(const touch of [false,true]){
  browser=await chromium.launch({channel:'msedge',headless:true,args:['--disable-gpu','--renderer-process-limit=2'],...(live?{proxy:{server:'http://127.0.0.1:7897'}}:{})});
  const context=await browser.newContext({hasTouch:touch,viewport:touch?{width:390,height:844}:{width:1280,height:1100},reducedMotion:'reduce'}),page=await context.newPage(),errors=[],requests=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
  const click=l=>touch?l.tap():l.click();await page.goto(url);await page.locator('#live .orb').waitFor();
  if(live)for(const name of Object.keys(files)){const response=await context.request.get(url+name);assert.equal(response.status(),200);assert.equal(await response.text(),await readFile(join(root,name),'utf8'));}
  const screen=page.locator('#live .screen'),orb=page.locator('#live .orb'),panel=page.locator('#live .panel');
  async function move(from,to,{cancel=false,inspect}={}){
   if(touch){
    const cdp=await context.newCDPSession(page);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[from]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[to]});if(inspect)await inspect();await cdp.send('Input.dispatchTouchEvent',{type:cancel?'touchCancel':'touchEnd',touchPoints:[]});await cdp.detach();
   }else{
    await page.mouse.move(from.x,from.y);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps:8});if(inspect)await inspect();if(cancel)await orb.dispatchEvent('pointercancel',{pointerId:1});await page.mouse.up();
   }
  }
  for(const plan of ['bean','bookmark','pebble','rail']){
   await click(page.locator('[data-plan='+plan+']'));await orb.scrollIntoViewIfNeeded();
   assert.equal(await orb.evaluate(e=>e.classList.contains('docked')),true);const small=await page.locator('#live .shape').boundingBox();assert.ok(small.width<=16,'edge visual should stay narrow');
   const ob=await orb.boundingBox(),sb=await screen.boundingBox();const from={x:ob.x+ob.width/2,y:ob.y+ob.height/2},to={x:sb.x+sb.width*.45,y:from.y+15};
   await move(from,to,{inspect:async()=>{
    assert.equal(await orb.evaluate(e=>e.classList.contains('docked')),false,'dragging away must immediately restore full button');
    const shape=await page.locator('#live .shape').boundingBox();assert.ok(shape.width>=39&&shape.height>=39);
    if(!touch)await screen.screenshot({path:join(dir,plan+'-dragging.png')});
   }});
   assert.equal(await orb.evaluate(e=>e.classList.contains('docked')&&e.classList.contains('left')),true,'release should dock to nearest side');
   assert.equal(await panel.isVisible(),false,'drag is not a click');const after=await orb.boundingBox();assert.ok(Math.abs(after.x-sb.x)<1);
   await click(orb);await panel.waitFor();await panel.locator('select').selectOption('灵感素材');
   await click(panel.locator('[data-action=paste]'));await click(panel.locator('button[type=submit]'));await panel.locator('.validation').waitFor();assert.equal(await panel.isVisible(),true);
   await panel.locator('textarea').fill('作品的分享文字 https://example.com/design-only');await click(panel.locator('button[type=submit]'));await page.locator('#live .capture-ui[data-status=working]').waitFor();assert.equal(await panel.isVisible(),false);
   if(plan==='bean'){
    await page.locator('#live .notice').getByText('已存入 · 灵感素材').waitFor();await page.locator('#live .notice').waitFor({state:'hidden',timeout:5000});assert.equal(await panel.isVisible(),false);assert.equal(await page.locator('#live .capture-ui').getAttribute('data-status'),'success');
   }
   await click(page.locator('[data-status=error]').filter({hasText:'失败'}));await page.locator('#live .notice').getByText('未保存 · 点开重试').waitFor();await click(page.locator('#live .notice'));await panel.locator('.panel-status').getByText('连接暂时中断',{exact:false}).waitFor();
   await click(panel.locator('.capture'));await page.locator('#live .capture-ui[data-status=working]').waitFor();assert.equal(await panel.isVisible(),false);
   await click(page.locator('#state-picker [data-status=idle]'));await click(orb);await panel.waitFor();await click(panel.locator('[data-action=browse]'));await page.locator('.phone-message').getByText('演示：这里会打开 ZNote 知识库').waitFor();assert.equal(await panel.isVisible(),false);
   if(!touch){
    await orb.focus();await page.keyboard.press('ArrowRight');assert.equal(await orb.evaluate(e=>e.classList.contains('right')),true);await page.keyboard.press('Enter');await panel.waitFor();await page.keyboard.press('Escape');await orb.waitFor();
   }
   await click(page.locator('#show-free'));await orb.scrollIntoViewIfNeeded();const free=await orb.boundingBox(),sc=await screen.boundingBox();
   await move({x:free.x+free.width/2,y:free.y+free.height/2},{x:sc.x+sc.width*.65,y:free.y+40},{cancel:true});assert.equal(await panel.isVisible(),false);assert.equal(await orb.evaluate(e=>e.classList.contains('docked')),true,'cancel should leave a usable docked handle');
   await click(page.locator('#show-panel'));await panel.waitFor();if(!touch)await screen.screenshot({path:join(dir,plan+'-expanded.png')});
   await click(panel.locator('.panel-heading'));assert.equal(await panel.isVisible(),false);await click(page.locator('#choose'));assert.match(await page.locator('#selection').textContent(),/未修改真实 App/);
  }
  await click(page.locator('#comparison [data-detail=bean]'));await orb.waitFor();await orb.scrollIntoViewIfNeeded();const s=await screen.boundingBox(),scroll=page.locator('#live .source-scroll');const before=await scroll.evaluate(e=>e.scrollTop);
  await move({x:s.x+s.width*.45,y:s.y+s.height*.7},{x:s.x+s.width*.45,y:s.y+s.height*.4});
  if(touch){
   assert.ok(await scroll.evaluate(e=>e.scrollTop)>before,'background source should still scroll when handle is collapsed');
   // A fling consumes the next tap while it is still moving. Wait for actual
   // scrolling to settle before resizing and operating the outside controls.
   await scroll.evaluate(e=>new Promise(resolve=>{let timer;const done=()=>{e.removeEventListener('scroll',settle);resolve();};const settle=()=>{clearTimeout(timer);timer=setTimeout(done,180);};e.addEventListener('scroll',settle);settle();}));
  }
  if(touch){
   await page.setViewportSize({width:320,height:780});await click(page.locator('#show-panel'));await panel.waitFor();const sizes=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));assert.ok(sizes.scroll<=sizes.width,'320px layout must not overflow');await page.screenshot({path:join(dir,'touch-320.png'),fullPage:true});
  }else{
   await page.setViewportSize({width:1800,height:1200});await page.goto(url+'?board=1');await page.locator('#comparison').waitFor();await page.screenshot({path:join(dir,'four-overlays.png'),fullPage:true});
  }
  assert.deepEqual(errors,[]);assert.ok(requests.every(r=>!new URL(r).pathname.startsWith('/api/')),'proposal must not call live capture APIs');
  result.paths.push({touch,allPlans:true,dragMorph:true,nearestSide:true,cancel:true,expanded:true,pasteValidation:true,librarySelection:true,backgroundSave:true,briefResult:true,failureRetry:true,browse:true,close:true,keyboard:!touch,backgroundScroll:touch,narrowScreen:touch,noApiCalls:true});await browser.close();browser=null;
 }
}finally{await browser?.close();if(server)await new Promise(r=>server.close(r));await writeFile(join(dir,'result.json'),JSON.stringify(result,null,2));console.log('Overlay preview evidence '+dir);}
