// Opt-in current-instance acceptance. Existing user soundtracks are read only.
// Run only after a resource check, production build and deployment.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {chromium} from 'playwright';
if(!process.argv.includes('--live'))throw Error('Pass --live');
const base=process.env.ZNOTE_BASE||'http://127.0.0.1:3741',db=new DatabaseSync('data/znote.sqlite');
db.exec('PRAGMA busy_timeout=5000');
const group=db.prepare("SELECT group_key,collection_id FROM items WHERE kind='image' AND bgm IS NOT NULL AND group_key IS NOT NULL AND deleted_at IS NULL GROUP BY group_key,collection_id HAVING count(*)>=2 LIMIT 1").get();
assert.ok(group,'An existing image group with a saved soundtrack is required');
const rows=db.prepare("SELECT id,title,bgm FROM items WHERE kind='image' AND group_key=? AND collection_id IS ? AND deleted_at IS NULL ORDER BY group_index,id").all(group.group_key,group.collection_id);
assert.ok(rows.every(row=>row.bgm));
const pinHash=()=>createHash('sha256').update(db.prepare("SELECT value FROM settings WHERE key='password'").get()?.value||'').digest('hex');
const beforePin=pinHash(),beforeRows=JSON.stringify(rows),tokenId=randomUUID(),token='zn_'+randomBytes(32).toString('hex');
const dir=await mkdtemp(resolve('artifacts/bgm-autoplay-live-')),result={ui:[]};let browser,page;
db.prepare('INSERT INTO tokens(id,name,hash,scope,kind,created_at,expires_at) VALUES(?,?,?,?,?,?,?)').run(tokenId,'临时图片组自动配乐验收',createHash('sha256').update(token).digest('hex'),'admin','session',new Date().toISOString(),new Date(Date.now()+3600000).toISOString());
try{
  for(const touch of [false,true]){
    browser=await chromium.launch({channel:'msedge',headless:true,args:['--mute-audio','--disable-gpu','--renderer-process-limit=2']});
    const context=await browser.newContext({viewport:touch?{width:390,height:844}:{width:1440,height:940},hasTouch:touch,isMobile:touch});
    await context.addCookies([{name:'znote_session',value:token,url:base,httpOnly:true,sameSite:'Strict'}]);
    // Headless Edge may permit localhost playback even without a gesture.
    // Inject one policy rejection only; all recovery and normal playback use
    // the real browser audio implementation and existing saved soundtrack.
    await context.addInitScript(()=>{
      const original=HTMLMediaElement.prototype.play;let denyOnce=true;
      HTMLMediaElement.prototype.play=function(...args){
        if(denyOnce&&this.matches('[data-znote-bgm]')){denyOnce=false;return Promise.reject(new DOMException('Policy rejection for acceptance','NotAllowedError'));}
        return original.apply(this,args);
      };
    });
    page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
    const click=loc=>touch?loc.tap():loc.click();
    await page.goto(base+'/#item/'+rows[0].id);
    const detail=page.getByRole('dialog',{name:'图片详情',exact:true}),controls=detail.getByRole('region',{name:'作品配乐'});
    // Policy rejection must be visible and clicking Play must recover,
    // without treating the saved audio file as invalid.
    await controls.getByText('浏览器阻止了自动播放，点击播放配乐即可',{exact:true}).waitFor();
    await click(controls.getByRole('button',{name:'播放配乐',exact:true}));
    await page.waitForFunction(()=>{const a=document.querySelector('[data-znote-bgm]');return !a.paused&&a.currentTime>.1;});
    console.log('PASS policy recovery '+(touch?'touch':'desktop'));
    await click(detail.getByRole('button',{name:'关闭窗口',exact:true}));await detail.waitFor({state:'hidden'});
    assert.ok(await page.locator('[data-znote-bgm]').evaluate(a=>a.paused&&!a.getAttribute('src')));
    await page.getByPlaceholder('搜索标题、正文或标签…',{exact:true}).fill(rows[0].title);
    const card=page.locator(`.item-card[data-item-id="${rows[0].id}"] .card-main`);await card.waitFor();await click(card);
    await page.waitForFunction(()=>{const a=document.querySelector('[data-znote-bgm]');return !a.paused&&a.currentTime>.1;});
    const before=await page.evaluate(()=>{window.__autoplayBgm=document.querySelector('[data-znote-bgm]');return {src:window.__autoplayBgm.src,time:window.__autoplayBgm.currentTime};});
    await click(detail.getByRole('button',{name:'下一张 →',exact:true}));
    await detail.getByText(`第 2 / ${rows.length} 张`,{exact:true}).waitFor();
    const after=await page.evaluate(()=>{const a=document.querySelector('[data-znote-bgm]');return {same:a===window.__autoplayBgm,src:a.src,time:a.currentTime,paused:a.paused};});
    assert.ok(after.same&&!after.paused);assert.equal(after.src,before.src);assert.ok(after.time>=before.time);
    await click(controls.getByRole('button',{name:'暂停配乐',exact:true}));
    await click(detail.getByRole('button',{name:'← 上一张',exact:true}));
    await detail.getByText(`第 1 / ${rows.length} 张`,{exact:true}).waitFor();
    assert.ok(await page.locator('[data-znote-bgm]').evaluate(a=>a.paused));
    await page.screenshot({path:join(dir,(touch?'touch':'desktop')+'.png'),mask:[page.locator('img')],maskColor:'#27322f'});
    await click(detail.getByRole('button',{name:'关闭窗口',exact:true}));await detail.waitFor({state:'hidden'});
    assert.ok(await page.locator('[data-znote-bgm]').evaluate(a=>a.paused&&!a.getAttribute('src')));
    let failOnce=true;
    await page.route('**/media/**/bgm',async route=>{if(failOnce){failOnce=false;await route.fulfill({status:503,body:'temporary audio failure'});}else await route.continue();});
    await click(card);await controls.getByRole('alert').waitFor();
    assert.equal(failOnce,false);
    await click(controls.getByRole('button',{name:'播放配乐',exact:true}));
    await page.waitForFunction(()=>{const a=document.querySelector('[data-znote-bgm]');return !a.paused&&a.currentTime>.1;});
    await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));
    assert.ok(await page.locator('[data-znote-bgm]').evaluate(a=>a.paused));
    await click(detail.getByRole('button',{name:'关闭窗口',exact:true}));await detail.waitFor({state:'hidden'});
    assert.deepEqual(errors,[]);result.ui.push({touch,cardOpenAutoplays:true,blockedAutoplayRecovers:'injected NotAllowedError',sameGroupContinues:true,pauseSurvivesPaging:true,closeStops:true,audio503Recovers:true,pageHideStops:true});
    console.log('PASS playback lifecycle '+(touch?'touch':'desktop'));
    await browser.close();browser=null;page=null;
  }
}catch(error){result.error=error.message;if(page&&!page.isClosed())await page.screenshot({path:join(dir,'failure.png'),mask:[page.locator('img')],maskColor:'#27322f'}).catch(()=>{});throw error;}
finally{
  await browser?.close();
  db.prepare('DELETE FROM tokens WHERE id=?').run(tokenId);
  assert.equal(pinHash(),beforePin);
  assert.equal(JSON.stringify(db.prepare('SELECT id,title,bgm FROM items WHERE id IN ('+rows.map(()=>'?').join(',')+') ORDER BY group_index,id').all(...rows.map(row=>row.id))),beforeRows);
  result.authCleaned=true;result.pinAndSoundtracksUnchanged=true;db.close();
  await writeFile(join(dir,'result.json'),JSON.stringify(result,null,2));console.log('Evidence: '+dir);
}
