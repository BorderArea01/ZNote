import {chromium} from 'playwright';
import {build} from 'esbuild';
import assert from 'node:assert/strict';
const bundle=await build({entryPoints:['extensions/clipper/work-images.js'],bundle:true,format:'iife',globalName:'Groups',write:false});
const browser=await chromium.launch({channel:'msedge',headless:true});
try {
 const page=await browser.newPage();await page.setContent('<main><img id="work" src="https://i.pximg.net/c/600x1200/img-master/12345_p1_master1200.jpg"><img id="recommendation" src="https://i.pximg.net/img-master/98765_p0.jpg"></main>');
 await page.addScriptTag({path:'extensions/clipper/candidates.js'});await page.addScriptTag({content:bundle.outputFiles[0].text});
 const result=await page.evaluate(async()=>{
  let calls=0;globalThis.fetch=async url=>{calls++;return{ok:true,text:async()=>JSON.stringify({body:String(url).endsWith('/pages')?[0,1,2].map(n=>({urls:{original:`https://i.pximg.net/img-original/12345_p${n}.png`}})):{title:'多页漫画',pageCount:3,description:'<img src="https://example.com/decoration.png">'}})};};
  const source=new URL('https://www.pixiv.net/artworks/12345');const group=await Groups.workImages(document.querySelector('#work'),document,source);
  await Groups.workImages(document.querySelector('#work'),document,source);
  return{group,calls,other:await Groups.workImages(document.querySelector('#recommendation'),document,source)};
 });
 assert.deepEqual(result.group.images,[0,1,2].map(n=>`https://i.pximg.net/img-original/12345_p${n}.png`));assert.equal(result.calls,2);assert.equal(result.other,null);
 await page.setContent('<main><h1>Paw 多图作品</h1><figure><a href="https://file.pawchive.pw/data/first.png?f=a.png"><img id="work" src="https://img.pawchive.pw/small.png"></a></figure><a class="fileThumb" href="https://file.pawchive.pw/data/second.png?f=b.png"><img src="https://img.pawchive.pw/small2.png"></a><article class="post-card--preview"><img id="other" src="https://file.pawchive.pw/other.png"></article></main>');
 const paw=await page.evaluate(async()=>{const source=new URL('https://pawchive.pw/fanbox/user/1/post/2');return{group:await Groups.workImages(document.querySelector('#work'),document,source),other:await Groups.workImages(document.querySelector('#other'),document,source)};});
 assert.equal(paw.group.images.length,2);assert.ok(paw.group.images.every(url=>url.startsWith('https://file.pawchive.pw/data/')));assert.equal(paw.other,null);
 console.log('PASS: Pixiv original page order, thumbnail matching, request cache and recommendation exclusion; Paw original attachments grouped without recommendation cards');
} finally {await browser.close();}
