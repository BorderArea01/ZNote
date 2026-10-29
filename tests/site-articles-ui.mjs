import {chromium} from 'playwright';
import {build} from 'esbuild';
import assert from 'node:assert/strict';
const bundle=await build({entryPoints:['addons/browser/clipper/site-articles.js'],bundle:true,format:'iife',globalName:'Adapters',write:false});
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
 const biliState={opus:{id:'1168138243068133376',detail:{basic:{title:'B站图文示例 - 哔哩哔哩'},modules:[
  {module_type:'MODULE_TYPE_TITLE',module_title:{text:'B站图文示例'}},
  {module_type:'MODULE_TYPE_AUTHOR',module_author:{name:'图文作者'}},
  {module_type:'MODULE_TYPE_CONTENT',module_content:{paragraphs:[
   {text:{nodes:[{type:'TEXT_NODE_TYPE_WORD',word:{words:'第一行\n第二行'}}]}},
   {pic:{pics:[{url:'http://i0.hdslb.com/bfs/new_dyn/one.png'},{url:'https://i0.hdslb.com/bfs/new_dyn/two.png'}]}}
  ]}}
 ]}}};
 await page.setContent(`<script>window.__INITIAL_STATE__=${JSON.stringify(biliState)};</script>`);
 const bili=await page.evaluate(async()=>{const a=await Adapters.siteArticle(document,new URL('https://m.bilibili.com/opus/1168138243068133376'));return{title:a.title,byline:a.byline,text:a.document.body.textContent,images:[...a.document.images].map(i=>i.src)};});
 assert.equal(bili.title,'B站图文示例');assert.equal(bili.byline,'图文作者');assert.match(bili.text,/第一行[\s\S]*第二行/);assert.deepEqual(bili.images,['https://i0.hdslb.com/bfs/new_dyn/one.png','https://i0.hdslb.com/bfs/new_dyn/two.png']);
 const biliRefetched=await page.evaluate(async(state)=>{document.body.innerHTML='<main>页面已水合，SSR 数据已移出</main>';const html=`<script>window.__INITIAL_STATE__=${JSON.stringify(state)};</script>`;const a=await Adapters.siteArticle(document,new URL('https://m.bilibili.com/opus/1168138243068133376'),async()=>({ok:true,text:async()=>html}));return{title:a.title,images:[...a.document.images].map(i=>i.src)};},biliState);
 assert.equal(biliRefetched.title,'B站图文示例');assert.deepEqual(biliRefetched.images,['https://i0.hdslb.com/bfs/new_dyn/one.png','https://i0.hdslb.com/bfs/new_dyn/two.png']);
 await page.setContent(`<main><header><img src="https://pawchive.pw/avatar.png"></header><h1>正文作品</h1><div class="post__content"><p>正文 <a href="/reference">带链接</a></p></div>
 <figure><a href="https://file.pawchive.pw/data/a.png?f=one.png"><img src="https://img.pawchive.pw/thumbnail/a.png"></a></figure>
 <a class="fileThumb" href="https://file.pawchive.pw/data/b.jpg?f=two.jpg"><img src="https://img.pawchive.pw/thumbnail/b.jpg"></a>
 <a class="fileThumb" href="https://file.pawchive.pw/data/a.png?f=one.png"><img src="data:,duplicate"></a>
 <a class="fileThumb" href="https://file.pawchive.pw/data/files.zip?f=files.zip">压缩包</a>
 <article class="post-card--preview"><figure><a href="https://file.pawchive.pw/data/unrelated.png"><img src="data:,recommendation"></a></figure></article></main>`);
 const paw=await page.evaluate(async()=>{const a=await Adapters.siteArticle(document,new URL('https://pawchive.pw/fanbox/user/1/post/2'));return{images:[...a.document.images].map(i=>i.src),content:a.document.body.textContent};});
 assert.deepEqual(paw.images,['https://file.pawchive.pw/data/a.png?f=one.png','https://file.pawchive.pw/data/b.jpg?f=two.jpg']);assert.ok(paw.content.includes('正文'));assert.ok(!paw.images.some(i=>i.includes('thumbnail')||i.includes('avatar')));
 await page.setContent('<main><h1>公开预览图组</h1><div class="post__files">'+[1,2,3,4,5].map(i=>'<figure><img data-src="https://img.pawchive.pw/thumbnail/data/'+i+'.jpg" src="data:,lazy"></figure>').join('')+'</div><aside><figure><img src="https://img.pawchive.pw/thumbnail/data/avatar.jpg"></figure></aside></main>');
 const preview=await page.evaluate(async()=>{const a=await Adapters.siteArticle(document,new URL('https://pawchive.pw/fanbox/user/1/post/3'));return {images:[...a.document.querySelectorAll('[data-znote-work-image]')].map(i=>({url:i.src,quality:i.getAttribute('data-znote-image-quality')})),text:a.document.body.textContent};});
 assert.equal(preview.images.length,5);assert.ok(preview.images.every((i,n)=>i.quality==='preview'&&i.url==='https://img.pawchive.pw/thumbnail/data/'+(n+1)+'.jpg'));assert.match(preview.text,/5 张保存网页预览图/);
 await page.setContent('<main><h1>混合画质</h1><figure><a href="https://n2.pawchive.pw/data/a.jpg"><img src="https://img.pawchive.pw/thumbnail/data/a.jpg"></a></figure><figure><img src="https://img.pawchive.pw/thumbnail/data/b.jpg"></figure><figure><img src="https://img.pawchive.pw/thumbnail/data/b.jpg"></figure><figure><img src="https://img.pawchive.pw.evil.test/thumbnail/data/c.jpg"></figure><figure><a href="https://file.pawchive.pw/data/f.zip"><img src="https://img.pawchive.pw/thumbnail/data/f.jpg"></a></figure></main>');
 const mixed=await page.evaluate(async()=>{const a=await Adapters.siteArticle(document,new URL('https://pawchive.pw/fanbox/user/1/post/4'));return [...a.document.querySelectorAll('[data-znote-work-image]')].map(i=>({url:i.src,quality:i.getAttribute('data-znote-image-quality')}));});
 assert.deepEqual(mixed,[{url:'https://n2.pawchive.pw/data/a.jpg',quality:null},{url:'https://img.pawchive.pw/thumbnail/data/b.jpg',quality:'preview'}]);
 const error=await page.evaluate(async()=>{try{await Adapters.siteArticle(document,new URL('https://pawchive.pw/fanbox/user/1'));return '';}catch(e){return e.message;}});assert.ok(error.includes('单篇'));
 console.log('PASS: Pixiv multi-page originals/descriptions and PawPreviewer figure/fileThumb originals; deduplication; avatars/recommendations/ZIP excluded; creator listing rejected');
}finally{await browser.close();}
