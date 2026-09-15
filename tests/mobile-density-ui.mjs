import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {resolve} from 'node:path';
import sharp from 'sharp';
import {createApp} from '../server/app.js';
const dir=await mkdtemp(resolve('artifacts/mobile-density-')),runtime=createApp({dataDir:dir,staticDir:resolve('dist')}),server=runtime.app.listen(0,'127.0.0.1');
await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({channel:'msedge',headless:true}),context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
const post=async(path,data)=>{const r=await context.request.post(base+path,{data});assert.ok(r.ok(),await r.text());return r.json();};
try{
 await post('/api/auth/setup',{password:'0915'});const lib=await post('/api/collections',{name:'手机密度检查'});
 await context.request.patch(base+'/api/preferences',{data:{default_collection_id:lib.id}});
 for(let i=0;i<10;i++){
  const buffer=await sharp({create:{width:300,height:240,channels:3,background:{r:80+i*12,g:100+i*7,b:160+i*4}}}).png().toBuffer();
  const r=await context.request.post(base+'/api/assets',{multipart:{file:{name:`image-${i}.png`,mimeType:'image/png',buffer},title:'旅行与灵感 '+i,collection_id:lib.id,tags:JSON.stringify(['灵感','旅行']),...(i<3?{group_key:'density:group',group_title:'海边照片组',group_index:String(i)}:{})}});assert.ok(r.ok());
 }
 await page.goto(base);await page.locator('.item-card').nth(7).waitFor();
 const columns=()=>page.locator('.items').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length);
 for(const width of [320,360,390,430,600,759]){
  await page.setViewportSize({width,height:900});await page.getByRole('button',{name:'网格视图',exact:true}).tap();assert.equal(await columns(),2);
  await page.getByRole('button',{name:'紧密网格视图',exact:true}).tap();assert.equal(await columns(),3,`compact grid at ${width}`);
  assert.equal(await page.locator('.item-card').count(),8);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  const geometry=await page.locator('.item-card').evaluateAll(cards=>cards.map(card=>{const c=card.getBoundingClientRect(),star=card.querySelector('.card-favorite-button').getBoundingClientRect(),title=card.querySelector('.card-body h3').getBoundingClientRect();return {starFits:star.left>=c.left&&star.right<=c.right&&star.bottom<=c.bottom,titleFits:title.right<=c.right,overlap:[...card.querySelectorAll('.card-meta span,.card-actions button')].some(el=>{const r=el.getBoundingClientRect();return r.width&&r.height&&Math.min(star.right,r.right)>Math.max(star.left,r.left)&&Math.min(star.bottom,r.bottom)>Math.max(star.top,r.top);})};}));
  assert.ok(geometry.every(g=>g.starFits&&g.titleFits&&!g.overlap),JSON.stringify({width,geometry}));
  if(width===390){await page.screenshot({path:resolve(dir,'compact-mobile.png')});}
 }
 await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'选择内容',exact:true}).tap();await page.getByRole('button',{name:'选择 海边照片组',exact:true}).tap();
 assert.equal(await page.locator('.item-card').count(),8);await page.locator('.item-card.is-selected').waitFor();
 const selected=page.locator('.item-card.is-selected'),check=await selected.locator('.card-select').boundingBox(),members=await selected.locator('.group-members-button').boundingBox();assert.ok(members.y>=check.y+check.height,'Group actions must not cover the checkbox');
 await page.screenshot({path:resolve(dir,'compact-selection.png')});
 await page.getByRole('button',{name:'退出选择',exact:true}).tap();await page.getByRole('button',{name:'打开 海边照片组',exact:true}).tap();await page.getByRole('dialog').waitFor();await page.getByRole('button',{name:'关闭窗口',exact:true}).tap();
 await page.reload();await page.locator('.items.compact-grid').waitFor();assert.equal(await columns(),3);
 await page.setViewportSize({width:1366,height:900});assert.ok(await columns()>3);assert.deepEqual(errors,[]);
 console.log('PASS mobile 3-column density 320–759px, controls fit, folded group selection, detail close, preference retention and desktop density; '+dir);
}finally{await browser.close();for(const key of ['captures','weixin','trash','imports','backups','webhooks'])await runtime[key].stop();await new Promise(r=>server.close(r));runtime.db.close();}
