// Opt-in acceptance of the user's recovered X tasks. Never creates new jobs.
import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {readFile,mkdtemp,writeFile} from 'node:fs/promises';import {resolve,join} from 'node:path';import {chromium} from 'playwright';
if(!process.argv.includes('--live'))throw Error('Pass --live');
const selected=process.argv.find(value=>value.startsWith('--job='))?.slice(6),count=Number(process.argv.find(value=>value.startsWith('--count='))?.slice(8));
if(selected)assert.ok(/^[a-f0-9-]{36}$/.test(selected)&&Number.isInteger(count)&&count>0,'Use --job=<uuid> --count=<members>');
const base='http://127.0.0.1:3741',ids=selected?[selected]:['d19faa9c-73f9-46a7-a8a2-4010bc214864','ee0b12a8-9ff5-4cc6-a946-2d746c0e5b24','2abd02e8-b745-45e5-afba-8ea9d2ba54d7'],expected=selected?[count]:[4,2,4];
const db=new DatabaseSync('data/znote.sqlite');db.exec('PRAGMA busy_timeout=5000');const tokenId=randomUUID(),token='zn_'+randomBytes(32).toString('hex'),headers={Authorization:'Bearer '+token},dir=await mkdtemp(resolve('artifacts/image-network-live-'));
const pinHash=()=>createHash('sha256').update(db.prepare("SELECT value FROM settings WHERE key='password'").get()?.value||'').digest('hex'),pin=pinHash(),result={jobs:[],ui:[]};let browser,page;
db.prepare('INSERT INTO tokens(id,name,hash,scope,kind,created_at,expires_at) VALUES(?,?,?,?,?,?,?)').run(tokenId,'临时图片网络恢复验收',createHash('sha256').update(token).digest('hex'),'admin','session',new Date().toISOString(),new Date(Date.now()+3600000).toISOString());
const api=async path=>{const response=await fetch(base+path,{headers});assert.ok(response.ok);return response.json();};
try{
 result.health=await api('/api/health');
 for(const [index,id] of ids.entries()){
  const job=await api('/api/captures/'+id);assert.equal(job.status,'completed');const group=await api('/api/item-groups/selection?id='+job.item_id);assert.equal(group.items.length,expected[index]);
  const rows=db.prepare("SELECT id,kind,hash,bytes,group_key,group_index,source_url,content FROM items WHERE source_url=? AND collection_id=? AND kind='image' AND deleted_at IS NULL ORDER BY group_index").all(job.source_url,job.collection_id);
  assert.equal(rows.length,expected[index]);assert.deepEqual(rows.map(row=>row.group_index),Array.from({length:expected[index]},(_,i)=>i));assert.ok(rows.every(row=>row.group_key===rows[0].group_key&&row.content.includes(job.source_url)));
  for(const row of rows){const response=await fetch(base+'/media/'+row.id+'/original',{headers});assert.ok(response.ok);const buffer=Buffer.from(await response.arrayBuffer());assert.equal(buffer.length,row.bytes);assert.equal(createHash('sha256').update(buffer).digest('hex'),row.hash);}
  if(!selected&&index===0)assert.equal(rows[0].hash,createHash('sha256').update(await readFile('artifacts/image-network/probe.bin')).digest('hex'));
  const replay=await fetch(base+'/api/captures/'+id+'/retry',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:'{}'});assert.equal(replay.status,409);
  result.jobs.push({id,first:job.item_id,members:rows.length,sourceAndRemarks:true,byteHashes:true,completedRetryRejected:true});
 }
 for(const touch of [false,true]){
  browser=await chromium.launch({channel:'msedge',headless:true,args:['--mute-audio','--disable-gpu','--renderer-process-limit=2']});const context=await browser.newContext({hasTouch:touch,isMobile:touch,viewport:touch?{width:390,height:844}:{width:1440,height:940}});await context.addCookies([{name:'znote_session',value:token,url:base,httpOnly:true,sameSite:'Strict'}]);page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));const click=loc=>touch?loc.tap():loc.click();
  for(const job of result.jobs){
   await page.goto(base+'/#item/'+job.first);const detail=page.getByRole('dialog',{name:'图片详情',exact:true}),strip=detail.getByRole('navigation',{name:'图片缩略图列'});await strip.waitFor();
   const expand=strip.getByRole('button',{name:'展开全部',exact:true});if(await expand.isVisible())await click(expand);
   for(let index=1;index<=job.members;index++){await click(strip.getByRole('option',{name:`查看第 ${index} 张图片`,exact:true}));await detail.getByText(`第 ${index} / ${job.members} 张`,{exact:true}).waitFor();await page.waitForFunction(()=>{const img=document.querySelector('button[aria-label="全屏查看图片"] img');return img?.complete&&img.naturalWidth>0;});}
   assert.ok(await detail.getByRole('button',{name:'下一张 →',exact:true}).isDisabled());
   if(!touch)await page.mouse.move(0,0);
   await page.screenshot({path:join(dir,job.id+'-'+(touch?'touch':'desktop')+'.png'),mask:[page.locator('img')],maskColor:'#27322f'});
   await click(detail.getByRole('button',{name:'关闭窗口',exact:true}));await detail.waitFor({state:'hidden'});result.ui.push({id:job.id,touch,allImagesLoad:true,lastBoundary:true,close:true});
  }
  assert.deepEqual(errors,[]);await browser.close();browser=null;page=null;console.log('PASS '+(touch?'touch':'desktop'));
 }
}catch(error){result.error=error.message;if(page&&!page.isClosed())await page.screenshot({path:join(dir,'failure.png'),mask:[page.locator('img')],maskColor:'#27322f'}).catch(()=>{});throw error;}
finally{await browser?.close();assert.equal(pinHash(),pin);db.prepare('DELETE FROM tokens WHERE id=?').run(tokenId);db.close();result.pinUnchanged=true;result.authCleaned=true;await writeFile(join(dir,'result.json'),JSON.stringify(result,null,2));console.log('Evidence: '+dir);}
