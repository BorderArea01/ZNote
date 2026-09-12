import {chromium} from 'playwright';
import {build} from 'esbuild';
import assert from 'node:assert/strict';
const bundle=await build({entryPoints:['extensions/clipper/site-articles.js'],bundle:true,format:'iife',globalName:'Adapters',write:false});
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage();await page.setContent('<main><h1>Fixture</h1><img src="data:,avatar"></main>');await page.addScriptTag({content:bundle.outputFiles[0].text});
 const pixiv=await page.evaluate(async()=>{
  const source=new URL('https://www.pixiv.net/artworks/12345');
  const calls=[];const adapter=await Adapters.siteArticle(document,source,async url=>{calls.push(String(url));return{ok:true,text:async()=>JSON.stringify({body:String(url).endsWith('/pages')?
   [1,2,3].map(i=>({urls:{original:`https://i.pximg.net/img-original/${i}.png`}})):
   {title:'多页作品',description:'<p>介绍 <a href="https://example.com/ref">参考链接</a></p>',userName:'作者',pageCount:3}})};});
  return {title:adapter.title,images:[...adapter.document.images].map(i=>i.src),links:adapter.document.querySelectorAll('a').length,calls};
 });
 assert.equal(pixiv.title,'多页作品');assert.equal(pixiv.images.length,3);assert.equal(pixiv.links,1);assert.deepEqual(pixiv.images,['1','2','3'].map(i=>`https://i.pximg.net/img-original/${i}.png`));assert.equal(pixiv.calls.length,2);
 await page.setContent(`<main><header><img src="https://pawchive.pw/avatar.png"></header><h1>正文作品</h1><div class="post__content"><p>正文 <a href="/reference">带链接</a></p></div>
 <figure><a href="https://file.pawchive.pw/data/a.png?f=one.png"><img src="https://img.pawchive.pw/thumbnail/a.png"></a></figure>
 <a class="fileThumb" href="https://file.pawchive.pw/data/b.jpg?f=two.jpg"><img src="https://img.pawchive.pw/thumbnail/b.jpg"></a>
 <a class="fileThumb" href="https://file.pawchive.pw/data/a.png?f=one.png"><img src="data:,duplicate"></a>
 <a class="fileThumb" href="https://file.pawchive.pw/data/files.zip?f=files.zip">压缩包</a>
 <article class="post-card--preview"><figure><a href="https://file.pawchive.pw/data/unrelated.png"><img src="data:,recommendation"></a></figure></article></main>`);
 const paw=await page.evaluate(async()=>{const a=await Adapters.siteArticle(document,new URL('https://pawchive.pw/fanbox/user/1/post/2'));return{images:[...a.document.images].map(i=>i.src),content:a.document.body.textContent};});
 assert.deepEqual(paw.images,['https://file.pawchive.pw/data/a.png?f=one.png','https://file.pawchive.pw/data/b.jpg?f=two.jpg']);assert.ok(paw.content.includes('正文'));assert.ok(!paw.images.some(i=>i.includes('thumbnail')||i.includes('avatar')));
 const error=await page.evaluate(async()=>{try{await Adapters.siteArticle(document,new URL('https://pawchive.pw/fanbox/user/1'));return '';}catch(e){return e.message;}});assert.ok(error.includes('单篇'));
 console.log('PASS: Pixiv multi-page originals/descriptions and PawPreviewer figure/fileThumb originals; deduplication; avatars/recommendations/ZIP excluded; creator listing rejected');
}finally{await browser.close();}
