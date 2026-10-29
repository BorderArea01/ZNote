// Read-only UI verification of explicitly selected, already recovered tasks.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {chromium} from 'playwright';
assert.ok(process.argv.includes('--live'));
const ids=process.argv.filter(v=>v.startsWith('--source-job=')).map(v=>v.slice(13));assert.ok(ids.length);
const base='http://127.0.0.1:3741',dir=await mkdtemp(resolve('artifacts/capture-recovery-ui-')),db=new DatabaseSync('data/znote.sqlite');db.exec('PRAGMA busy_timeout=5000');
const jobs=JSON.parse(db.prepare("SELECT value FROM settings WHERE key='mobile_captures_v1'").get().value),items=[];
for(const id of ids){const job=jobs.find(j=>j.id===id);assert.equal(job?.status,'completed');const first=db.prepare('SELECT * FROM items WHERE id=?').get(job.item_id);assert.ok(first);const rows=first.group_key?db.prepare('SELECT * FROM items WHERE group_key=? AND collection_id=? AND deleted_at IS NULL ORDER BY group_index').all(first.group_key,first.collection_id):[first];for(const row of rows){assert.equal(row.collection_id,job.input.collection_id);if(!items.some(i=>i.id===row.id))items.push(row);}}
const auth=randomUUID(),token='zn_'+randomBytes(32).toString('hex');db.prepare('INSERT INTO tokens VALUES(?,?,?,?,?,?,?)').run(auth,'补采只读UI验收临时会话',createHash('sha256').update(token).digest('hex'),'admin','session',new Date().toISOString(),new Date(Date.now()+1800000).toISOString());
let browser,context;const result={checks:[]};
try{
 browser=await chromium.launch({channel:'msedge',headless:true,args:['--mute-audio','--disable-gpu','--renderer-process-limit=2']});
 for(const touch of [false,true]){
  context=await browser.newContext({hasTouch:touch,viewport:{width:touch?390:1280,height:900}});context.setDefaultTimeout(20000);
  await context.addCookies([{name:'znote_session',value:token,url:base,httpOnly:true,sameSite:'Lax'}]);
  await context.route(base+'/api/**',async route=>{
   const req=route.request();if(['GET','HEAD'].includes(req.method()))return route.continue();
   if(new URL(req.url()).pathname==='/api/video-progress'){const data=req.postDataJSON(),r=await fetch(base+'/api/video-progress?collection='+(data.collection_id||'unfiled'),{headers:{Authorization:'Bearer '+token}});return route.fulfill({json:await r.json()});}
   return route.abort();
  });
  const page=await context.newPage();
  for(const item of items){
   await page.goto(base+'/#item/'+item.id);await page.locator('.detail-dialog').waitFor();
   if(item.kind==='video'){
    const video=page.locator('.detail-dialog video');await video.waitFor();await page.waitForFunction(()=>document.querySelector('.detail-dialog video')?.readyState>=2);
    await video.evaluate(async v=>{v.muted=true;await v.play();});await page.waitForFunction(()=>document.querySelector('.detail-dialog video')?.currentTime>.2);await video.evaluate(v=>v.pause());
   }else{await page.waitForFunction(()=>{const img=document.querySelector('.image-stage img');return img?.complete&&img.naturalWidth>0;});}
   await page.screenshot({path:join(dir,(touch?'touch-':'desktop-')+item.id+'.png'),mask:[page.locator('img,video')]});
   await page.keyboard.press('Escape');await page.locator('.detail-dialog').waitFor({state:'hidden'});result.checks.push({itemId:item.id,kind:item.kind,touch,decoded:true,played:item.kind==='video',closed:true});
  }
  await context.close();context=null;
 }
 result.status='passed';
}catch(e){result.error=e.message;throw e;}finally{await context?.close();await browser?.close();db.prepare('DELETE FROM tokens WHERE id=?').run(auth);db.close();result.temporaryAuthRemoved=true;await writeFile(join(dir,'result.json'),JSON.stringify(result,null,2));console.log('Evidence '+dir);}
