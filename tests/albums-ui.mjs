// Opt-in acceptance on the current service; only our temporary library and
// authentication token are written. Run one browser at a time via the guard.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import sharp from 'sharp';
import {chromium} from 'playwright';
if(!process.argv.includes('--live'))throw Error('Pass --live for current-instance acceptance');
const base=process.env.ZNOTE_BASE||'http://127.0.0.1:3741',dir=await mkdtemp(resolve('artifacts/albums-live-'));
const db=new DatabaseSync('data/znote.sqlite');db.exec('PRAGMA busy_timeout=5000');
const tokenId=randomUUID(),token='zn_'+randomBytes(32).toString('hex'),cookie='znote_session='+token;
const pinHash=()=>createHash('sha256').update(db.prepare("SELECT value FROM settings WHERE key='password'").get()?.value||'').digest('hex');const beforePin=pinHash();
db.prepare('INSERT INTO tokens(id,name,hash,scope,kind,created_at,expires_at) VALUES(?,?,?,?,?,?,?)').run(tokenId,'临时相册验收',createHash('sha256').update(token).digest('hex'),'admin','session',new Date().toISOString(),new Date(Date.now()+3600000).toISOString());
const ownedLibraries=[];let browser,page;const result={ui:[]};
async function api(path,method='GET',body){const r=await fetch(base+path,{method,headers:{Cookie:cookie,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});const value=r.status===204?null:await r.json();if(!r.ok)throw Error(r.status+' '+JSON.stringify(value));return value;}
try {
  result.health=await api('/api/health');result.schema=db.prepare('PRAGMA user_version').get().user_version;assert.equal(result.schema,15);
  for(const touch of [false,true]) {
    const library=await api('/api/collections','POST',{name:'临时相册验收 '+(touch?'触屏':'桌面')+' '+Date.now()});ownedLibraries.push(library.id);
    const rows=[];
    for(const [index,color] of ['#288472','#6973da'].entries()) {
      const data=await sharp({create:{width:320,height:240,channels:3,background:color}}).png().toBuffer(),form=new FormData();form.set('file',new Blob([data],{type:'image/png'}),'相册图 '+index+'.png');form.set('collection_id',library.id);form.set('group_key','manual:album-test:'+library.id);form.set('group_title','验收图片组');form.set('group_index',String(index));
      const r=await fetch(base+'/api/assets',{method:'POST',headers:{Cookie:cookie},body:form});assert.ok(r.ok,await r.clone().text());rows.push(await r.json());
    }
    const note=await api('/api/items','POST',{title:'验收笔记',content:'收藏不复制原文件，也不更改正文。',collection_id:library.id});
    const errors=[];
    browser=await chromium.launch({channel:'msedge',headless:true,args:['--mute-audio','--disable-gpu','--renderer-process-limit=2']});
    const context=await browser.newContext({viewport:touch?{width:390,height:844}:{width:1440,height:940},hasTouch:touch,isMobile:touch});await context.addCookies([{name:'znote_session',value:token,url:base,httpOnly:true,sameSite:'Strict'}]);await context.addInitScript(()=>localStorage.setItem('znote-theme','dark'));page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    const click=locator=>touch?locator.tap():locator.click();
    const openNav=async()=>{if(touch&&!await page.locator('.sidebar-shade').isVisible())await click(page.getByRole('button',{name:'打开导航',exact:true}));};
    const closeNav=async()=>{if(touch&&await page.locator('.sidebar-shade').isVisible())await page.locator('.sidebar-shade').tap({position:{x:370,y:420}});};
    await page.goto(base+'/?item='+note.id);await page.getByRole('dialog').waitFor();await click(page.getByRole('dialog').getByRole('button',{name:'关闭窗口',exact:true}));
    await openNav();await click(page.getByRole('button',{name:'管理自定义相册',exact:true}));let manager=page.getByRole('dialog',{name:'自定义相册',exact:true});await manager.waitFor();
    for(const name of ['素材参考','创作灵感']){await manager.getByRole('textbox',{name:'新相册名称',exact:true}).fill(name);await click(manager.getByRole('button',{name:'新建',exact:true}));await manager.locator('.album-manager-row').filter({hasText:name}).waitFor();}
    await click(manager.getByRole('button',{name:'重命名 素材参考',exact:true}));await manager.getByRole('textbox',{name:'重命名相册',exact:true}).fill('设计参考');await click(manager.getByRole('button',{name:'保存相册名称',exact:true}));await manager.getByRole('button',{name:'重命名 设计参考',exact:true}).waitFor();
    await click(manager.getByRole('button',{name:'自定义相册说明',exact:true}));await page.getByRole('tooltip').waitFor();assert.ok(await page.getByRole('tooltip').isVisible());await page.keyboard.press('Escape');
    await page.screenshot({path:join(dir,(touch?'touch':'desktop')+'-manager.png')});await click(manager.getByRole('button',{name:'完成',exact:true}));
    await closeNav();
    const groupCard=page.locator('.item-card[data-item-id="'+rows[0].id+'"]');await groupCard.waitFor();
    if(!touch)await groupCard.hover();await click(groupCard.getByRole('button',{name:/管理收藏/}));let picker=page.getByRole('dialog',{name:'收藏到…',exact:true});await picker.waitFor();await picker.getByText('管理 2 项内容的收藏',{exact:true}).waitFor();
    for(const name of ['默认收藏','设计参考','创作灵感'])await picker.locator('.album-target').filter({hasText:name}).getByRole('checkbox').check();
    await page.route('**/api/favorite-targets',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'验收用暂时断网'})}));await click(picker.getByRole('button',{name:'保存收藏',exact:true}));await picker.getByRole('alert').waitFor();assert.ok((await picker.getByRole('alert').innerText()).includes('暂时断网'));
    await page.unroute('**/api/favorite-targets');await click(picker.getByRole('button',{name:'重新加载',exact:true}));await page.waitForFunction(()=>{const button=[...document.querySelectorAll('button')].find(node=>node.textContent==='保存收藏');return button&&!button.disabled});
    await page.screenshot({path:join(dir,(touch?'touch':'desktop')+'-picker.png')});await click(picker.getByRole('button',{name:'保存收藏',exact:true}));await picker.waitFor({state:'hidden'});
    const albums=(await api('/api/albums?collection='+library.id)).albums,selected=albums.find(row=>row.name==='设计参考');assert.ok(albums.every(row=>row.card_count===1));
    await openNav();await page.getByRole('combobox',{name:'选择收藏分区',exact:true}).selectOption(selected.id);await page.waitForFunction(()=>document.querySelectorAll('.item-card').length===1);assert.equal((await api('/api/items?collection='+library.id+'&album='+selected.id+'&grouped=true')).total,1);
    await click(page.getByRole('button',{name:'打开 验收图片组',exact:true}));let detail=page.getByRole('dialog',{name:'图片详情',exact:true});await detail.waitFor();assert.equal(await detail.getByRole('option',{name:/查看第 \d 张图片/}).count(),2);await click(detail.getByRole('option',{name:'查看第 2 张图片',exact:true}));await detail.getByRole('button',{name:'上一张',exact:false}).waitFor();
    await click(detail.getByRole('button',{name:'收藏 / 相册',exact:true}));picker=page.getByRole('dialog',{name:'收藏到…',exact:true});await picker.waitFor();await picker.getByText('管理 2 项内容的收藏',{exact:true}).waitFor();await click(picker.getByRole('button',{name:'取消',exact:true}));await click(detail.getByRole('button',{name:'关闭窗口',exact:true}));
    await openNav();await click(page.getByRole('button',{name:'管理自定义相册',exact:true}));manager=page.getByRole('dialog',{name:'自定义相册',exact:true});await manager.waitFor();await click(manager.getByRole('button',{name:'删除 创作灵感',exact:true}));await click(manager.getByRole('button',{name:'删除相册',exact:true}));await manager.getByRole('button',{name:'删除 创作灵感',exact:true}).waitFor({state:'hidden'});assert.equal((await api('/api/items?collection='+library.id)).total,3);assert.ok((await api('/api/items/'+rows[0].id)).favorite);
    await click(manager.getByRole('button',{name:'完成',exact:true}));await closeNav();
    await openNav();await click(page.getByRole('button',{name:/全部内容/}));await page.waitForFunction(()=>document.querySelectorAll('.item-card').length===2);
    await click(page.getByRole('button',{name:'选择内容',exact:true}));await click(page.getByRole('checkbox',{name:'选择当前页全部内容',exact:true}));await page.getByText('已选 3 项',{exact:true}).waitFor();assert.ok(await page.getByRole('checkbox',{name:'选择当前页全部内容',exact:true}).isChecked());
    await click(page.getByRole('region',{name:'批量管理',exact:true}).getByRole('button',{name:'收藏 / 相册',exact:true}));picker=page.getByRole('dialog',{name:'收藏到…',exact:true});await picker.getByText('管理 3 项内容的收藏',{exact:true}).waitFor();await picker.locator('.album-target').filter({hasText:'设计参考'}).getByRole('checkbox').check();await click(picker.getByRole('button',{name:'保存收藏',exact:true}));await picker.waitFor({state:'hidden'});
    assert.equal((await api('/api/items?collection='+library.id+'&album='+selected.id+'&grouped=true')).total,2);
    await click(page.getByRole('region',{name:'批量管理',exact:true}).getByRole('button',{name:'批量标签',exact:true}));const tagDialog=page.getByRole('dialog',{name:'批量标签 · 3 项内容',exact:true});await tagDialog.getByRole('textbox',{name:'批量编辑标签',exact:true}).fill('验收标记');await tagDialog.getByRole('textbox',{name:'批量编辑标签',exact:true}).press('Enter');await click(tagDialog.getByRole('button',{name:'应用标签',exact:true}));await tagDialog.waitFor({state:'hidden'});assert.ok((await api('/api/items?collection='+library.id)).items.every(row=>row.tags.includes('验收标记')));await click(page.getByRole('button',{name:'退出多选',exact:true}));
    await openNav();await page.getByRole('combobox',{name:'选择收藏分区',exact:true}).selectOption(selected.id);await page.waitForFunction(()=>document.querySelectorAll('.item-card').length===2);
    // Force an actual update notice without changing the current result.
    await api('/api/items/'+note.id,'PATCH',{version:(await api('/api/items/'+note.id)).version,title:'验收笔记已更新'});await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.locator('.browse-update').waitFor();
    const toolbar=await page.locator('.toolbar').boundingBox(),banner=await page.locator('.browse-update').boundingBox();assert.ok(banner.y-(toolbar.y+toolbar.height)>=12,'Toolbar/update banner gap must be at least 12px');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No horizontal page overflow');await page.screenshot({path:join(dir,(touch?'touch':'desktop')+'-layout.png')});
    await click(page.getByRole('button',{name:'忽略更新提示',exact:true}));await page.locator('.browse-update').waitFor({state:'hidden'});assert.deepEqual(errors,[]);
    await openNav();await click(page.getByRole('button',{name:'管理自定义相册',exact:true}));manager=page.getByRole('dialog',{name:'自定义相册',exact:true});await click(manager.getByRole('button',{name:'删除 设计参考',exact:true}));await click(manager.getByRole('button',{name:'删除相册',exact:true}));await manager.getByRole('button',{name:'删除 设计参考',exact:true}).waitFor({state:'hidden'});await click(manager.getByRole('button',{name:'完成',exact:true}));await openNav();await page.waitForFunction(()=>document.querySelector('[aria-label="选择收藏分区"]')?.value==='');assert.equal((await api('/api/items?collection='+library.id)).total,3);await closeNav();
    result.ui.push({touch,createRenameDelete:true,activeAlbumDeletionFallback:true,wholeGroupTwoAlbums:true,batchNotesAndGroups:true,consecutiveBatchTags:true,failureRetry:true,previewPaging:true,closeAndHelp:true,spacing:banner.y-toolbar.y-toolbar.height,noHorizontalOverflow:true});await browser.close();browser=null;page=null;console.log('PASS '+(touch?'touch':'desktop'));
  }
} catch(error){result.error=error.message;if(page)await page.screenshot({path:join(dir,'failed.png')}).catch(()=>{});throw error;}
finally {
  if(browser)await browser.close();
  for(const collection of ownedLibraries){const rows=(await api('/api/items?collection='+collection+'&limit=100')).items;for(const row of rows)await api('/api/items/'+row.id,'DELETE');const ids=rows.map(row=>row.id);if(ids.length){const preview=await api('/api/trash/preview','POST',{collection_id:collection,ids});await api('/api/trash/purge','POST',{collection_id:collection,ids,revision:preview.revision,confirm:'DELETE'});}await api('/api/collections/'+collection,'DELETE');}
  assert.equal(pinHash(),beforePin);db.prepare('DELETE FROM tokens WHERE id=?').run(tokenId);db.close();result.cleaned=true;result.pinUnchanged=true;await writeFile(join(dir,'result.json'),JSON.stringify(result,null,2));console.log('Evidence: '+dir);
}
