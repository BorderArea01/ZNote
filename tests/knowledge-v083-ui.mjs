import {chromium} from 'playwright';
import {mkdtemp,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import sharp from 'sharp';
import assert from 'node:assert/strict';
import {createApp} from '../server/app.js';
const dir=await mkdtemp(resolve('artifacts/knowledge-ui-v083-'));
const png=await sharp({create:{width:30,height:30,channels:3,background:'#8caa99'}}).png().toBuffer();
const runtime=createApp({dataDir:dir,staticDir:resolve(process.env.UI_DIST||'dist'),imageDownload:async()=>png});
const server=runtime.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({channel:'msedge',headless:true});const context=await browser.newContext({viewport:{width:1440,height:1050}}),page=await context.newPage();
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const post=async(path,data)=>{const r=await context.request.post(base+path,{data});assert.ok(r.ok(),await r.text());return r.json();};
try{
 await post('/api/auth/setup',{password:'0831'});const a=await post('/api/collections',{name:'项目 A'}),b=await post('/api/collections',{name:'项目 B'});
 for(let i=0;i<22;i++){
  const buffer=await sharp({create:{width:50+i,height:50,channels:3,background:'#8caa99'}}).png().toBuffer();
  const r=await context.request.post(base+'/api/assets',{multipart:{file:{name:`A-${i}.png`,mimeType:'image/png',buffer},collection_id:a.id,tags:'["组A"]'}});assert.ok(r.ok());
 }
 await post('/api/items',{title:'B 的私有笔记',collection_id:b.id,tags:['B 标签'],favorite:true,content:'只属于 B'});
 const old=await post('/api/items',{title:'待归档笔记',collection_id:a.id,content:'![reference](https://images.test/test.png)',archive_images:false});
 await context.request.patch(base+'/api/preferences',{data:{default_collection_id:a.id}});
 await page.goto(base);await page.getByRole('button',{name:'打开 A-0.png',exact:true}).waitFor();
 for(const label of ['全部内容','图片素材','视频素材','图文笔记','我的收藏','回收站']){
  await page.locator('.sidebar').getByRole('button',{name:new RegExp('^'+label)}).click();
  await page.waitForFunction(()=>!document.querySelector('.loading-state'));
  assert.equal(await page.getByRole('button',{name:'打开 B 的私有笔记',exact:true}).count(),0);
  assert.equal(await page.getByRole('button',{name:'筛选标签：B 标签',exact:true}).count(),0);
 }
 await page.locator('.sidebar').getByRole('button',{name:/^图片素材/}).click();
 await page.getByRole('button',{name:'筛选标签：组A',exact:true}).click();
 await page.getByRole('button',{name:'选择内容',exact:true}).click();
 await page.getByRole('checkbox',{name:'选择当前页全部内容'}).check();
 await page.getByText('已选 22 项（每次最多 100 项）',{exact:true}).waitFor();
 await page.screenshot({path:resolve('artifacts/v083-batch-delete.png')});
 await page.getByRole('button',{name:'删除所选',exact:true}).click();
 await page.getByRole('status').filter({hasText:'已将 22 项'}).waitFor();
 assert.equal((await(await context.request.get(base+'/api/stats?collection='+a.id)).json()).trash,22);
 assert.equal((await(await context.request.get(base+'/api/stats?collection='+b.id)).json()).trash,0);
 await page.locator('.sidebar').getByRole('button',{name:/^回收站/}).click();
 await page.getByRole('button',{name:'选择内容',exact:true}).click();await page.getByRole('checkbox',{name:'选择当前页全部内容'}).check();
 await page.getByRole('button',{name:'恢复所选',exact:true}).click();await page.getByRole('status').filter({hasText:'已恢复 22 项'}).waitFor();
 await page.locator('.sidebar').getByRole('button',{name:/^项目 B /}).click();await page.getByRole('button',{name:'打开 B 的私有笔记',exact:true}).waitFor();assert.equal(await page.locator('.item-card').count(),1);
 await page.locator('.sidebar').getByRole('button',{name:/^全部内容/}).click();await page.getByRole('button',{name:'打开 B 的私有笔记',exact:true}).waitFor();assert.equal(await page.locator('.item-card').count(),1);
 await page.goto(base+'/#item/'+old.id);await page.getByRole('button',{name:'归档外部配图',exact:true}).click();
 await page.getByRole('status').filter({hasText:'1 张配图已归档'}).waitFor();
 const note=await(await context.request.get(base+'/api/items/'+old.id)).json();assert.ok(note.content.includes('/media/'));assert.ok(!note.content.includes('https://images.test'));
 await page.getByRole('button',{name:'预览',exact:true}).click();await page.locator('.markdown-preview img').waitFor();
 assert.ok((await page.locator('.markdown-preview img').getAttribute('src')).startsWith('/media/'));
 await page.screenshot({path:resolve('artifacts/v083-local-note.png')});
 assert.deepEqual(errors,[]);console.log('PASS: all six categories stay in their library; 22 tag-filtered images batch deleted/restored; B untouched; deep link changes library; old note images archive locally');
}catch(e){await page.screenshot({path:resolve('artifacts/v083-knowledge-failure.png')});throw e;}
finally{await browser.close();await runtime.imports.stop();await runtime.backups.stop();await runtime.webhooks.stop();await new Promise(r=>server.close(r));runtime.db.close();}
