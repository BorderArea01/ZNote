// Current-instance acceptance: only clearly owned test records are changed.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import sharp from 'sharp';
import {chromium} from 'playwright';
if(!process.argv.includes('--live'))throw Error('Pass --live');
const base='http://127.0.0.1:3741',dir=await mkdtemp(resolve('artifacts/navigation-live-'));
const db=new DatabaseSync('data/znote.sqlite');db.exec('PRAGMA busy_timeout=5000');
const id=randomUUID(),token='zn_'+randomBytes(32).toString('hex'),owned=[];
const pin=()=>createHash('sha256').update(db.prepare("SELECT value FROM settings WHERE key='password'").get()?.value||'').digest('hex'),originalPin=pin();
db.prepare('INSERT INTO tokens VALUES(?,?,?,?,?,?,?)').run(id,'界面临时验收',createHash('sha256').update(token).digest('hex'),'admin','session',new Date().toISOString(),new Date(Date.now()+1800000).toISOString());
const api=async(path,method='GET',body)=>{const r=await fetch(base+path,{method,headers:{Cookie:'znote_session='+token,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});const result=r.status===204?null:await r.json();assert.ok(r.ok,JSON.stringify(result));return result;};
const report={checks:[]};let browser,page;
try{
 report.health=await api('/api/health');
 browser=await chromium.launch({channel:'msedge',headless:true,args:['--mute-audio','--disable-gpu','--renderer-process-limit=2']});
 for(const touch of [false,true]){
  const library=await api('/api/collections','POST',{name:'界面验收 '+Date.now()});owned.push(library.id);
  const rows=[];
  for(let i=0;i<2;i++){
   const form=new FormData();form.set('file',new Blob([await sharp({create:{width:240,height:180,channels:3,background:i?'#8997a6':'#adb1b9'}}).png().toBuffer()]),'测试图'+i+'.png');form.set('collection_id',library.id);form.set('group_key','manual:navigation:'+library.id);form.set('group_title','界面验收图组');form.set('group_index',String(i));
   const r=await fetch(base+'/api/assets',{method:'POST',headers:{Cookie:'znote_session='+token},body:form});assert.ok(r.ok);rows.push(await r.json());
  }
  for(let n=0;n<3;n++)await api('/api/items','POST',{title:'验收笔记'+n,content:'只用于当前实例验收',collection_id:library.id,tags:Array.from({length:24},(_,i)=>'验收标签'+String(n*24+i).padStart(2,'0'))});
  const context=await browser.newContext({viewport:touch?{width:390,height:844}:{width:1440,height:1000},hasTouch:touch,isMobile:touch});await context.addCookies([{name:'znote_session',value:token,url:base,httpOnly:true,sameSite:'Strict'}]);page=await context.newPage();const errors=[];page.on('pageerror',e=>{errors.push(e.message);report.errors=errors;console.log('Page error: '+e.message)});
  const click=l=>touch?l.tap():l.click();const openNav=async()=>{if(touch&&!await page.locator('.sidebar-shade').isVisible())await click(page.getByRole('button',{name:'打开导航',exact:true}));};const closeNav=async()=>{if(touch&&await page.locator('.sidebar-shade').isVisible())await page.locator('.sidebar-shade').tap({position:{x:370,y:420}});};
  await page.goto(base);await openNav();await click(page.locator('.collections-nav').getByRole('button',{name:new RegExp('^'+library.name)}));await page.locator('.item-card').first().waitFor();await openNav();
  assert.equal(await page.getByRole('button',{name:'管理自定义相册',exact:true}).count(),0);assert.equal(await page.getByRole('combobox',{name:'选择收藏分区',exact:true}).count(),0);
  assert.equal(await page.locator('.local-plugin-nav').count(),0);const plugin=page.getByRole('button',{name:'管理知识库插件',exact:true});
  assert.equal(await page.getByRole('region',{name:'侧栏多标签筛选',exact:true}).count(),0);
  const entry=await plugin.boundingBox();assert.ok(entry.y+entry.height<(touch?844:1000));
  await page.screenshot({path:join(dir,(touch?'touch':'desktop')+'-sidebar.png')});await closeNav();
  const filter=page.getByRole('region',{name:'按标签筛选',exact:true});
  assert.equal(await page.locator('.tag-browser').count(),1);await filter.getByRole('button',{name:'下一页标签',exact:true}).waitFor();assert.equal(await filter.locator('.tag-options>button').count(),40);
  await click(filter.getByRole('button',{name:'下一页标签',exact:true}));await filter.getByRole('button',{name:'筛选标签：验收标签40',exact:true}).waitFor();
  await click(filter.getByRole('button',{name:'筛选标签：验收标签40',exact:true}));await page.waitForFunction(()=>document.querySelectorAll('.item-card').length===1);
  await filter.getByLabel('搜索筛选标签').fill('验收标签71');await filter.getByRole('button',{name:'筛选标签：验收标签71',exact:true}).waitFor();await filter.getByLabel('标签匹配方式').selectOption('any');await click(filter.getByRole('button',{name:'筛选标签：验收标签71',exact:true}));await filter.getByRole('button',{name:'移除筛选标签：验收标签40',exact:true}).waitFor();
  await page.route('**/api/tags?**',r=>new URL(r.request().url()).searchParams.get('q')==='失败'?r.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'验收暂时离线'})}):r.continue());await filter.getByLabel('搜索筛选标签').fill('失败');await filter.getByRole('button',{name:'重试标签',exact:true}).waitFor();assert.equal(await filter.locator('.tag-selection button[aria-label]').count(),2);await page.unrouteAll();await click(filter.getByRole('button',{name:'重试标签',exact:true}));await filter.getByText('没有匹配的标签，试试其他关键词。',{exact:true}).waitFor();
  await filter.getByLabel('搜索筛选标签').fill('');await filter.locator('.tag-options>button').first().waitFor();await click(filter.getByRole('button',{name:/按标签筛选/}).first());await filter.getByText('已选 2 个 · 任意匹配',{exact:true}).waitFor();await click(filter.getByRole('button',{name:'清除筛选',exact:true}));await page.waitForFunction(()=>document.querySelectorAll('.item-card').length===4);
  const card=page.locator('.item-card').filter({has:page.getByRole('button',{name:'打开 界面验收图组',exact:true})});
  await page.route('**/api/favorite-targets',r=>r.fulfill({status:409,contentType:'application/json',body:JSON.stringify({error:'验收收藏冲突，请重试'})}));await click(card.getByRole('button',{name:/^收藏 /}));await page.getByText('验收收藏冲突，请重试',{exact:true}).waitFor();assert.equal((await api('/api/items/'+rows[0].id)).favorite,false);await page.unrouteAll();
  let response=page.waitForResponse(r=>r.url()===base+'/api/favorite-targets'&&r.request().method()==='POST');await click(card.getByRole('button',{name:/^收藏 /}));assert.equal((await response).status(),200);for(const row of rows)assert.equal((await api('/api/items/'+row.id)).favorite,true);assert.equal(await page.getByRole('dialog').count(),0);
  await click(page.getByRole('button',{name:'打开 界面验收图组',exact:true}));let detail=page.getByRole('dialog',{name:'图片详情',exact:true});await detail.waitFor();await click(detail.getByRole('button',{name:'取消收藏',exact:true}));await detail.getByRole('button',{name:'收藏',exact:true}).waitFor();for(const row of rows)assert.equal((await api('/api/items/'+row.id)).favorite,false);await click(detail.getByRole('button',{name:'关闭窗口',exact:true}));
  await click(page.getByRole('button',{name:'选择内容',exact:true}));await click(page.getByRole('checkbox',{name:'选择当前页全部内容',exact:true}));await page.getByText('已选 5 项',{exact:true}).waitFor();const bar=page.getByRole('region',{name:'批量管理',exact:true});await click(bar.getByRole('button',{name:'收藏所选',exact:true}));await bar.getByRole('button',{name:'取消收藏',exact:true}).waitFor();assert.equal((await api('/api/items?collection='+library.id+'&favorite=true&grouped=true')).total,4);await click(page.getByRole('button',{name:'退出多选',exact:true}));
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);await page.screenshot({path:join(dir,(touch?'touch':'desktop')+'-content.png')});report.checks.push({touch,noSidebarTags:true,contentTags:72,searchPagingSelectionAndRecovery:true,directWholeGroupFavorite:true,batchFavorite:true,noCustomAlbumUI:true,noOverflow:true});await context.close();page=null;
 }
}catch(e){report.error=e.stack;if(page)await page.screenshot({path:join(dir,'failure.png')}).catch(()=>{});throw e;}finally{
 await browser?.close();
 for(const library of owned){const {items}=await api('/api/items?collection='+library+'&limit=100');for(const row of items)await api('/api/items/'+row.id,'DELETE');const ids=items.map(r=>r.id);if(ids.length){const preview=await api('/api/trash/preview','POST',{collection_id:library,ids});await api('/api/trash/purge','POST',{collection_id:library,ids,revision:preview.revision,confirm:'DELETE'});}await api('/api/collections/'+library,'DELETE');}
 assert.equal(pin(),originalPin);db.prepare('DELETE FROM tokens WHERE id=?').run(id);db.close();report.cleaned=true;await writeFile(join(dir,'result.json'),JSON.stringify(report,null,2));console.log('Evidence '+dir);
}
