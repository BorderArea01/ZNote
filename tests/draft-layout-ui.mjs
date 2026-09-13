import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createApp} from '../server/app.js';

const dir=await mkdtemp(resolve('artifacts/draft-layout-'));
const runtime=createApp({dataDir:dir,staticDir:resolve(process.env.UI_DIST||'dist')}),server=runtime.app.listen(0,'127.0.0.1');
await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({channel:'msedge',headless:true}),context=await browser.newContext(),page=await context.newPage(),errors=[];
page.on('pageerror',e=>errors.push(e.message));
const detail=()=>page.getByRole('dialog',{name:'图文笔记',exact:true});
const post=async(path,data)=>{const r=await context.request.post(base+path,{data});assert.ok(r.ok());return r.json();};
try {
  await post('/api/auth/setup',{password:'0933'});
  await context.request.patch(base+'/api/preferences',{data:{default_collection_id:'unfiled'}});
  const note=await post('/api/items',{title:'草稿冲突排版检查',content:'知识库原文',tags:Array.from({length:15},(_,i)=>'标签'+i)});
  const open=()=>page.getByRole('button',{name:'打开 草稿冲突排版检查',exact:true}).click();
  await page.goto(base);await open();await detail().getByRole('button',{name:'编辑',exact:true}).click();
  await page.getByLabel('笔记正文',{exact:true}).fill('尚未提交的本地草稿\n\n保留这段文字');
  await detail().getByRole('status').filter({hasText:'草稿已保存在此浏览器'}).waitFor();
  await detail().getByRole('button',{name:'关闭窗口',exact:true}).click();
  const updated=await context.request.patch(base+'/api/items/'+note.id,{data:{version:note.version,content:'其他窗口保存的新内容'}});assert.ok(updated.ok());
  await open();await page.getByRole('button',{name:'对照草稿',exact:true}).waitFor();
  for(const [width,height] of [[1366,768],[1280,600],[390,844],[320,568],[844,390]]) {
    await page.setViewportSize({width,height});
    for(const theme of ['light','dark']) {
      await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;document.documentElement.dataset.palette='slate';},theme);await page.waitForTimeout(200);
      const box=await detail().evaluate(el=>{const rect=n=>{const r=n.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};return {dialog:rect(el),banner:rect(el.querySelector('.draft-conflict')),text:rect(el.querySelector('.draft-conflict > span')),button:rect(el.querySelector('.draft-conflict button')),toolbar:rect(el.querySelector('.note-editor-toolbar')),footer:rect(el.querySelector('.detail-bottom')),body:rect(el.querySelector('.markdown-preview')),overflow:el.scrollWidth>el.clientWidth};});
      assert.ok(box.banner.left-box.dialog.left>=11&&box.dialog.right-box.banner.right>=11,`banner inset ${width} ${theme}`);
      assert.ok(box.text.left-box.banner.left>=11&&box.banner.right-box.button.right>=10,'banner inner padding');
      assert.ok(box.text.right<=box.banner.right&&box.button.bottom<=box.banner.bottom,'banner children fit');
      assert.ok(box.toolbar.bottom<=box.footer.top&&box.body.height>=20,'toolbar leaves document space');assert.equal(box.overflow,false);
      if(theme==='dark'&&[1366,390].includes(width))await page.screenshot({path:resolve(`artifacts/draft-inset-${width}.png`)});
    }
  }
  await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'对照草稿',exact:true}).click();
  const compare=page.getByRole('dialog',{name:'对照本地草稿',exact:true});
  assert.equal(await compare.getByLabel('本地草稿正文',{exact:true}).inputValue(),'尚未提交的本地草稿\n\n保留这段文字');
  assert.ok(await compare.evaluate(el=>el.scrollWidth<=el.clientWidth));
  await page.evaluate(()=>{const original=IDBDatabase.prototype.transaction;window.denyDraftWrites=true;IDBDatabase.prototype.transaction=function(stores,mode,...rest){if(window.denyDraftWrites&&this.name==='znote-writing'&&mode==='readwrite')throw new DOMException('No space','QuotaExceededError');return original.call(this,stores,mode,...rest);};});
  await compare.getByRole('button',{name:'丢弃这份草稿',exact:true}).click();await page.getByText('草稿删除失败，请重试',{exact:true}).waitFor();
  assert.equal(await compare.count(),1,'Failed deletion must keep comparison open');
  await page.evaluate(()=>window.denyDraftWrites=false);await compare.getByRole('button',{name:'丢弃这份草稿',exact:true}).click();await compare.waitFor({state:'hidden'});
  assert.equal(await page.locator('.draft-conflict').count(),0);assert.equal(runtime.db.prepare('SELECT content FROM items WHERE id=?').get(note.id).content,'其他窗口保存的新内容');
  assert.deepEqual(errors,[]);console.log('PASS: conflict banner insets and fit across 5 viewports / light and dark, narrow comparison, failed discard recovery and server content preservation');
} finally {await browser.close();await runtime.weixin.stop();await runtime.trash.stop();await runtime.imports.stop();await runtime.backups.stop();await runtime.webhooks.stop();await new Promise(r=>server.close(r));runtime.db.close();}
