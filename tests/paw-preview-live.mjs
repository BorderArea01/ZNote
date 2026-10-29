// Exercise the installed extension against the current server with synthetic
// public-preview files. Never download the user's referenced artwork.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import sharp from 'sharp';
import {chromium} from 'playwright';
assert.ok(process.argv.includes('--live'));
const dir=await mkdtemp(resolve('artifacts/paw-preview-live-')),base='http://127.0.0.1:3741';
const db=new DatabaseSync('data/znote.sqlite');db.exec('PRAGMA busy_timeout=5000');
const pin=db.prepare("SELECT value FROM settings WHERE key='password'").get()?.value;
const adminId=randomUUID(),writeId=randomUUID(),admin='zn_'+randomBytes(32).toString('hex'),token='zn_'+randomBytes(32).toString('hex');
for(const [id,key,scope,kind] of [[adminId,admin,'admin','session'],[writeId,token,'write','api']])db.prepare('INSERT INTO tokens VALUES(?,?,?,?,?,?,?)').run(id,'Paw 预览图验收临时授权',createHash('sha256').update(key).digest('hex'),scope,kind,new Date().toISOString(),new Date(Date.now()+1800000).toISOString());
const api=async(path,method='GET',body)=>{const r=await fetch(base+path,{method,headers:{Authorization:'Bearer '+admin,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(60000)}),v=r.status===204?null:await r.json();assert.ok(r.ok,JSON.stringify(v));return v;};
let collection,context;const result={ui:[],images:[]};
try{
 assert.equal((await api('/api/health')).status,'ok');
 collection=await api('/api/collections','POST',{name:'Paw预览图验收 '+randomUUID().slice(0,8)});
 const extension='C:/Users/31093/Downloads/clipper';const manifest=JSON.parse(await readFile(join(extension,'manifest.json'),'utf8'));assert.equal(manifest.version,'0.9.43');result.extensionVersion=manifest.version;
 context=await chromium.launchPersistentContext(join(dir,'profile'),{channel:'msedge',headless:true,hasTouch:true,viewport:{width:1280,height:900},args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`,'--mute-audio','--disable-gpu','--renderer-process-limit=2']});context.setDefaultTimeout(15000);
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');await worker.evaluate(c=>chrome.storage.local.set(c),{server:base,token,collection_id:collection.id,tags:'验收',saveAction:'save'});
 const source='https://pawchive.pw/fanbox/user/901/post/902';
 const imageURL=i=>'https://img.pawchive.pw/thumbnail/data/fixture-'+i+'.png';
 const images=[];for(let i=0;i<5;i++)images.push(await sharp({create:{width:640,height:480,channels:3,background:{r:30+i*30,g:100,b:180}}}).png().toBuffer());
 let fail=true;const attempts=[0,0,0,0,0];
 await context.route('https://**/*',async route=>{
  const u=new URL(route.request().url());
  if(u.hostname==='img.pawchive.pw'){
   const i=Number(u.pathname.match(/fixture-(\d+)\.png/)?.[1]);assert.ok(Number.isInteger(i)&&i<5);
   // Ordinary page thumbnails remain available; inject one failure only in
   // the extension's fetch, after the gallery has been recognized.
   if(route.request().resourceType()!=='image'){attempts[i]++;if(i===1&&fail)return route.fulfill({status:503,body:'Fixture unavailable'});}
   return route.fulfill({contentType:'image/png',body:images[i]});
  }
  assert.equal(u.href,source);
  return route.fulfill({contentType:'text/html;charset=utf-8',body:'<!doctype html><meta charset="utf-8"><title>公开预览图组验收</title><style>body{font:16px system-ui;margin:30px;background:#eceff2}figure{display:inline-block;margin:8px}img{width:180px;height:135px}</style><main><h1>公开预览图组验收</h1><div class="post__content">合成色块，验证页面现有图片成组保存。</div><p class="post__previews-note">Previews only</p><div class="post__files">'+images.map((_,i)=>'<div class="post__thumbnail"><figure><img id="picture-'+i+'" data-src="'+imageURL(i)+'" src="'+imageURL(i)+'"></figure></div>').join('')+'</div></main>'});
 });
 const p=await context.newPage();await p.goto(source);const root=p.locator('[data-znote-overlay]');
 await p.locator('#picture-0').hover();const toolbar=root.locator('.paw-source');await toolbar.getByRole('button',{name:'此作品整组入库',exact:true}).click();
 const frame=await(await root.locator('.inline-save iframe:not([hidden])').elementHandle()).contentFrame();
 await frame.locator('#save-status').filter({hasText:/已入库 4 \/ 5 张，1 张失败/}).waitFor({timeout:30000});
 assert.match(await frame.locator('#summary').innerText(),/5 张网页预览图/);
 assert.equal(db.prepare('SELECT count(*) n FROM items WHERE collection_id=?').get(collection.id).n,4);
 await p.screenshot({path:join(dir,'desktop-failure.png')});result.ui.push('one-failure-does-not-block-other-four');
 fail=false;await frame.getByRole('button',{name:'重试未入库',exact:true}).click();await frame.getByRole('button',{name:'全部已入库',exact:true}).waitFor({timeout:30000});
 const rows=db.prepare('SELECT * FROM items WHERE collection_id=? ORDER BY group_index').all(collection.id);assert.equal(rows.length,5);
 for(const [i,row] of rows.entries()){assert.equal(row.group_key,'paw:fanbox:901:902');assert.equal(row.group_index,i);assert.equal(row.source_url,source);assert.match(row.content,/画质：网页预览图/);assert.equal(row.hash,createHash('sha256').update(images[i]).digest('hex'));result.images.push({id:row.id,index:i,width:row.width,height:row.height,hash:row.hash});}
 const ticket=await worker.evaluate(async()=>Object.values(await chrome.storage.session.get(null)).find(v=>v?.source_url==='https://pawchive.pw/fanbox/user/901/post/902'&&v.images));assert.deepEqual(ticket.preview_indexes,[0,1,2,3,4]);assert.deepEqual(ticket.images,[0,1,2,3,4].map(imageURL));
 await p.screenshot({path:join(dir,'desktop-completed.png')});
 await p.setViewportSize({width:390,height:844});await p.screenshot({path:join(dir,'touch-completed.png')});
 await root.getByRole('button',{name:'收起套图面板',exact:true}).tap();await root.locator('.inline-save').waitFor({state:'hidden'});await root.locator('.inline-save-badge').tap();await root.locator('.inline-save').waitFor();await p.keyboard.press('Escape');await root.locator('.inline-save').waitFor({state:'hidden'});
 result.ui.push('five-group-members-and-quality-note','retry-does-not-duplicate','touch-collapse-reopen-and-escape');
 // Inspect the actual knowledge-base viewer using the same temporary library.
 await context.addCookies([{name:'znote_session',value:admin,url:base,httpOnly:true,sameSite:'Lax'}]);const library=await context.newPage();await library.goto(base+'/#item/'+rows[0].id);
 await library.locator('.detail-dialog').waitFor();await library.getByRole('button',{name:'全屏查看图片',exact:true}).waitFor();
 await library.waitForFunction(()=>{const img=document.querySelector('.image-stage img');return img?.complete&&img.naturalWidth===640;});
 await library.locator('.gallery-strip button').nth(4).waitFor();
 await library.waitForFunction(()=>{const imgs=[...document.querySelectorAll('.gallery-strip img')];return imgs.length===5&&imgs.every(img=>img.complete&&img.naturalWidth>0);});
 await library.screenshot({path:join(dir,'library-group.png')});await library.keyboard.press('Escape');await library.locator('.detail-dialog').waitFor({state:'hidden'});result.ui.push('current-library-image-viewer-five-members-decode-and-close');
 result.status='passed';
}catch(error){result.error=error.message;throw error;}finally{
 await context?.close();
 try{if(collection){const rows=db.prepare('SELECT id FROM items WHERE collection_id=?').all(collection.id);for(const row of rows)await api('/api/items/'+row.id,'DELETE');if(rows.length){const ids=rows.map(r=>r.id),preview=await api('/api/trash/preview','POST',{collection_id:collection.id,ids});await api('/api/trash/purge','POST',{collection_id:collection.id,ids,revision:preview.revision,confirm:'DELETE'});}await api('/api/collections/'+collection.id,'DELETE');}result.cleaned=true;}catch(error){result.cleanupError=error.message;process.exitCode=1;}
 assert.equal(db.prepare("SELECT value FROM settings WHERE key='password'").get()?.value,pin);db.prepare('DELETE FROM tokens WHERE id IN (?,?)').run(adminId,writeId);db.close();
 await writeFile(join(dir,'result.json'),JSON.stringify(result,null,2));console.log('Evidence '+dir);
}
