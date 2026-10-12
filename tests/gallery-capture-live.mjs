// Explicit current-instance acceptance. Retries the user's existing failed
// gallery, never creates a second job or deletes their saved content.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {chromium} from 'playwright';
import {fetchRemoteImage} from '../server/remote-images.js';
if(!process.argv.includes('--live'))throw Error('Pass --live');
const base='http://127.0.0.1:3741',source='https://www.jliji.com/set/2281',jobId='264f86c6-d156-4364-a573-8b8f2c329907',dir=await mkdtemp(resolve('artifacts/gallery-capture-live-'));
const db=new DatabaseSync('data/znote.sqlite');db.exec('PRAGMA busy_timeout=5000');
const tokenId=randomUUID(),token='zn_'+randomBytes(32).toString('hex'),cookie='znote_session='+token;
const pinHash=()=>createHash('sha256').update(db.prepare("SELECT value FROM settings WHERE key='password'").get()?.value||'').digest('hex'),beforePin=pinHash();
db.prepare('INSERT INTO tokens(id,name,hash,scope,kind,created_at,expires_at) VALUES(?,?,?,?,?,?,?)').run(tokenId,'临时图集真实验收',createHash('sha256').update(token).digest('hex'),'admin','session',new Date().toISOString(),new Date(Date.now()+3600000).toISOString());
const result={ui:[]};let browser,page;
async function api(path,method='GET',body){const r=await fetch(base+path,{method,headers:{Cookie:cookie,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});const value=await r.json();assert.ok(r.ok,JSON.stringify(value));return value;}
try{
  result.health=await api('/api/health');const prior=await api('/api/captures/'+jobId);assert.equal(prior.source_url,source);
  const {plan}=await api('/api/captures/resolve','POST',{text:source,image_mode:'group'});assert.equal(plan.images.length,101);assert.equal(plan.parser,'jliji-gallery-v1');assert.ok(plan.images.every(v=>!v.includes('/thumbs/')));result.resolved={count:plan.images.length,parser:plan.parser,mode:plan.default_image_mode};
  if(prior.status==='failed')await api('/api/captures/'+jobId+'/retry','POST',{});else assert.equal(prior.status,'completed');
  let job,lastMessage='',lastPrint=0;const deadline=Date.now()+12*60000;
  while(Date.now()<deadline){job=await api('/api/captures/'+jobId);if(job.message!==lastMessage&&Date.now()-lastPrint>15000){console.log(job.status+': '+job.message);lastMessage=job.message;lastPrint=Date.now();}if(['failed','completed'].includes(job.status))break;await new Promise(r=>setTimeout(r,1500));}
  result.job=job;assert.equal(job.status,'completed',job.message);
  const first=await api('/api/items/'+job.item_id),group=await api('/api/item-groups/selection?id='+job.item_id);result.groupCount=group.items.length;assert.equal(group.items.length,101);
  const rows=group.items.map(item=>db.prepare('SELECT id,kind,group_key,group_index,source_url,content,width,height,hash,bytes FROM items WHERE id=?').get(item.id)).sort((a,b)=>a.group_index-b.group_index);
  assert.deepEqual(rows.map(row=>row.group_index),Array.from({length:101},(_,i)=>i));assert.ok(rows.every(row=>row.kind==='image'&&row.group_key===first.group_key&&row.source_url===source&&row.content===plan.content+'\n\n来源链接：'+source));
  const folded=await api('/api/items?collection='+(first.collection_id||'unfiled')+'&grouped=true&kind=image&q='+encodeURIComponent(plan.title));assert.equal(folded.items.filter(row=>row.group_key===first.group_key).length,1);
  result.originalChecks=[];
  for(const index of [0,50,100]){const raw=await fetchRemoteImage(plan.images[index]);assert.equal(createHash('sha256').update(raw).digest('hex'),rows[index].hash);const r=await fetch(base+'/media/'+rows[index].id+'/original',{headers:{Cookie:cookie}});assert.ok(r.ok);const local=Buffer.from(await r.arrayBuffer());assert.deepEqual(local,raw);result.originalChecks.push({index,width:rows[index].width,height:rows[index].height,bytes:local.length,identical:true});}
  assert.ok(rows.filter(row=>row.width>300||row.height>400).length>90);result.largeOriginalCount=rows.filter(row=>row.width>300||row.height>400).length;result.totalBytes=rows.reduce((sum,row)=>sum+row.bytes,0);
  for(const touch of [false,true]){
    const errors=[];browser=await chromium.launch({channel:'msedge',headless:true,args:['--mute-audio','--disable-gpu','--renderer-process-limit=2']});
    const context=await browser.newContext({viewport:touch?{width:390,height:844}:{width:1440,height:940},hasTouch:touch,isMobile:touch});await context.addCookies([{name:'znote_session',value:token,url:base,httpOnly:true,sameSite:'Strict'}]);await context.addInitScript(()=>localStorage.setItem('znote-theme','dark'));page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));const click=loc=>touch?loc.tap():loc.click();
    const loadedImage=async()=>{await page.waitForFunction(()=>{const image=document.querySelector('button[aria-label="全屏查看图片"] img');return image?.complete&&image.naturalWidth>0&&image.naturalHeight>0;});};
    await page.goto(base+'/#item/'+first.id);const detail=page.getByRole('dialog',{name:'图片详情',exact:true}),strip=page.getByRole('navigation',{name:'图片缩略图列'});await strip.waitFor();await detail.getByText('第 1 / 101 张',{exact:true}).waitFor();await loadedImage();assert.ok(await detail.getByRole('button',{name:'← 上一张',exact:true}).isDisabled());
    const expand=strip.getByRole('button',{name:'展开全部',exact:true});if(await expand.isVisible())await click(expand);
    for(const index of [51,101]){await click(strip.getByRole('option',{name:`查看第 ${index} 张图片`,exact:true}));await detail.getByText(`第 ${index} / 101 张`,{exact:true}).waitFor();await loadedImage();const nextExpand=strip.getByRole('button',{name:'展开全部',exact:true});if(index===51&&await nextExpand.isVisible())await click(nextExpand);}
    assert.ok(await detail.getByRole('button',{name:'下一张 →',exact:true}).isDisabled());await click(detail.getByRole('button',{name:'← 上一张',exact:true}));await detail.getByText('第 100 / 101 张',{exact:true}).waitFor();await click(detail.getByRole('button',{name:'下一张 →',exact:true}));await detail.getByText('第 101 / 101 张',{exact:true}).waitFor();
    // Keep personal media obscured in artifacts while checking real DOM and
    // original API bytes rather than replacing media with test fixtures.
    await page.screenshot({path:join(dir,(touch?'touch':'desktop')+'.png'),mask:[page.locator('img')],maskColor:'#27322f'});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await click(detail.getByRole('button',{name:'关闭窗口',exact:true}));await detail.waitFor({state:'hidden'});assert.deepEqual(errors,[]);result.ui.push({touch,firstMiddleLast:true,imagesDecoded:true,previousNextBoundaries:true,close:true,noHorizontalOverflow:true});await browser.close();browser=null;page=null;console.log('PASS '+(touch?'touch':'desktop'));
  }
}catch(e){result.error=e.message;if(page)await page.screenshot({path:join(dir,'failed.png'),mask:[page.locator('img')],maskColor:'#27322f'}).catch(()=>{});throw e;}
finally{if(browser)await browser.close();assert.equal(pinHash(),beforePin);db.prepare('DELETE FROM tokens WHERE id=?').run(tokenId);db.close();result.pinUnchanged=true;result.authCleaned=true;await writeFile(join(dir,'result.json'),JSON.stringify(result,null,2));console.log('Evidence: '+dir);}
