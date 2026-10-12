// Opt-in acceptance against the running service. Does not restore user data.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {mkdtemp,writeFile,readFile,stat} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {chromium} from 'playwright';
import {mediaKeys} from '../server/bgm.js';
if(!process.argv.includes('--live'))throw Error('Pass --live for running-instance acceptance');
const base=process.env.ZNOTE_BASE||'http://127.0.0.1:3741',dir=await mkdtemp(resolve('artifacts/backup-space-ui-'));
const db=new DatabaseSync('data/znote.sqlite');db.exec('PRAGMA busy_timeout=5000');
const id=randomUUID(),token='zn_'+randomBytes(32).toString('hex'),cookie='znote_session='+token;
const pinHash=()=>createHash('sha256').update(db.prepare("SELECT value FROM settings WHERE key='password'").get()?.value||'').digest('hex'),beforePin=pinHash();
db.prepare('INSERT INTO tokens(id,name,hash,scope,kind,created_at,expires_at) VALUES(?,?,?,?,?,?,?)').run(id,'临时快照容量验收',createHash('sha256').update(token).digest('hex'),'admin','session',new Date().toISOString(),new Date(Date.now()+600000).toISOString());
const result={ui:[]};let browser,page;
async function api(path,method='GET',body){const r=await fetch(base+path,{method,headers:{Cookie:cookie,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});const value=await r.json();assert.ok(r.ok,JSON.stringify(value));return value;}
try{
  result.health=await api('/api/health');const before=await api('/api/backups?refresh_space=true');assert.equal(before.keep,1);assert.equal(before.max_extra_mb,1024);assert.equal(before.busy,false);
  if(process.argv.includes('--snapshot')||process.argv.includes('--verify-snapshot')){
    await api('/api/backups/policy','PATCH',{enabled:before.enabled,interval_hours:before.interval_hours,keep:1,max_extra_mb:1024});
    result.created=process.argv.includes('--snapshot')?await api('/api/backups','POST',{}):{id:before.backups[0].id};
    const status=await api('/api/backups?refresh_space=true');assert.equal(status.backups.length,1);const entry=status.backups[0];assert.equal(entry.id,result.created.id);assert.equal(entry.copied_files,0);assert.equal(entry.linked_files,entry.files);assert.equal(status.last_error,null);assert.ok(status.space.additional_bytes<status.limit_bytes);
    const keys=mediaKeys(db);
    let shared=0;for(const file_key of keys){const live=await stat(join('data/media',file_key),{bigint:true}),saved=await stat(join('data/backups',entry.id,'data/media',file_key),{bigint:true});assert.equal(saved.ino,live.ino);assert.equal(saved.dev,live.dev);shared++;}
    result.snapshot={...entry,verifiedShared:shared,space:status.space,limit:status.limit_bytes};
  }
  for(const touch of [false,true]){
    const errors=[];browser=await chromium.launch({channel:'msedge',headless:true,args:['--mute-audio','--disable-gpu','--renderer-process-limit=2']});
    const context=await browser.newContext({viewport:touch?{width:390,height:844}:{width:1440,height:940},hasTouch:touch,isMobile:touch});await context.addCookies([{name:'znote_session',value:token,url:base,httpOnly:true,sameSite:'Strict'}]);await context.addInitScript(()=>localStorage.setItem('znote-theme','dark'));page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));const click=loc=>touch?loc.tap():loc.click();
    await page.goto(base);if(touch)await click(page.getByRole('button',{name:'打开导航',exact:true}));await click(page.getByRole('button',{name:'设置与连接',exact:true}));const dialog=page.getByRole('dialog',{name:'设置与连接',exact:true}),section=dialog.locator('.backup-settings');await section.locator('.backup-space').waitFor();
    const limit=section.getByRole('spinbutton',{name:'恢复快照容量上限MiB'}),save=section.getByRole('button',{name:'保存快照设置',exact:true});assert.equal(await limit.inputValue(),'1024');assert.equal(await section.getByRole('spinbutton',{name:'恢复快照保留版本数'}).inputValue(),'1');
    await limit.fill('63');await click(save);await section.getByRole('alert').waitFor();assert.equal(await limit.inputValue(),'63');assert.equal((await api('/api/backups')).max_extra_mb,1024);
    await limit.fill('1024');await page.route('**/api/backups/policy',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'验收用临时连接失败'})}));await click(save);await section.getByText('验收用临时连接失败',{exact:true}).waitFor();assert.equal(await limit.inputValue(),'1024');await page.unroute('**/api/backups/policy');await click(save);await page.waitForFunction(()=>!document.querySelector('.backup-settings [role="alert"]'));await click(section.getByRole('button',{name:'重新核对占用',exact:true}));await page.waitForFunction(()=>!document.querySelector('.backup-settings [role="status"]'));
    const help=section.getByRole('button',{name:'快照容量上限说明'});await click(help);const tip=page.getByRole('tooltip').filter({hasText:'快照容量上限'});await tip.waitFor();await page.waitForTimeout(200);assert.ok(await tip.isVisible());assert.ok((await tip.innerText()).includes('不会复制整库'));const tipBox=await tip.boundingBox();assert.ok(tipBox.x>=0&&tipBox.x+tipBox.width<=(touch?390:1440));await page.keyboard.press('Escape');await tip.waitFor({state:'hidden'});assert.ok(await dialog.isVisible());
    if(!touch){await help.focus();await help.press('Enter');await tip.waitFor();await help.press('Escape');await tip.waitFor({state:'hidden'});}
    await section.scrollIntoViewIfNeeded();await page.screenshot({path:join(dir,(touch?'touch':'desktop')+'.png')});await section.screenshot({path:join(dir,(touch?'touch':'desktop')+'-section.png')});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await click(dialog.getByRole('button',{name:'关闭窗口',exact:true}));await dialog.waitFor({state:'hidden'});assert.deepEqual(errors,[]);result.ui.push({touch,invalidBoundary:true,failedSaveRetry:true,helpCloseKeyboardAndTouch:true,spaceRefresh:true,noPageOverflow:true});await browser.close();browser=null;page=null;console.log('PASS '+(touch?'touch':'desktop'));
  }
  const policy=JSON.parse(await readFile('data/backups/policy.json'));assert.equal(policy.keep,1);assert.equal(policy.max_extra_mb,1024);result.policy={keep:policy.keep,max_extra_mb:policy.max_extra_mb};result.status=await api('/api/backups?refresh_space=true');
}catch(e){result.error=e.message;if(page)await page.screenshot({path:join(dir,'failed.png')}).catch(()=>{});throw e;}
finally{if(browser)await browser.close();assert.equal(pinHash(),beforePin);db.prepare('DELETE FROM tokens WHERE id=?').run(id);db.close();result.cleaned=true;result.pinUnchanged=true;await writeFile(join(dir,'result.json'),JSON.stringify(result,null,2));console.log('Evidence: '+dir);}
