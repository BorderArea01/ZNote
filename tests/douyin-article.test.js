import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';import {resolve} from 'node:path';import sharp from 'sharp';
import {douyinArticle,extractDouyinArticle} from '../server/capture-douyin-article.js';
import {extractCapturePage} from '../server/capture-page.js';
import {douyinWork,hasCaptureResources} from '../server/capture-browser.js';
import {createApp} from '../server/app.js';
const url='https://www.douyin.com/article/7701602252825316646',id='7701602252825316646';
const article=(content='## 小标题\n\n文章开头。\n\n文章结尾。')=>({aweme_id:id,aweme_type:163,desc:'摘要不能替代正文',author:{nickname:'作者'},article_info:{article_id:id,article_title:'完整文章',has_more:false,article_content:JSON.stringify({long_article_abstract:'摘要',markdown:content})},video:{cover:{url_list:['https://cdn.example/cover.jpg']}}});
const html=record=>'<script type="application/json">'+JSON.stringify({aweme_detail:record})+'</script>';

test('article recognition and complete Markdown preserve title, author, body and canonical source',()=>{
 assert.equal(douyinArticle(url),id);assert.equal(douyinWork(url),id);assert.equal(douyinArticle('https://douyin.com.evil.test/article/'+id),'');
 const plan=extractCapturePage(html(article()),url);assert.equal(plan.kind,'note');assert.equal(plan.capture_format,'douyin-article');assert.equal(plan.url,url);assert.equal(plan.title,'完整文章');assert.equal(plan.author,'作者');assert.match(plan.content,/^## 小标题/);assert.match(plan.content,/文章结尾/);assert.equal(plan.images,undefined);assert.equal(plan.video_urls,undefined);assert.equal(hasCaptureResources(plan),true);assert.equal(hasCaptureResources({kind:'note',content:'login'}),false);
});

test('wrong work, partial body, broken JSON and abstract-only data never become a saved article',()=>{
 const cases=[{...article(),aweme_id:'1'}, {...article(),article_info:{...article().article_info,article_id:'1'}}, {...article(),article_info:{...article().article_info,has_more:true}}, {...article(),article_info:{...article().article_info,article_content:'broken'}}, {...article(),article_info:{...article().article_info,article_content:JSON.stringify({long_article_abstract:'只有摘要'})}}];
 for(const record of cases)assert.throws(()=>extractDouyinArticle(record,url));
 assert.throws(()=>extractCapturePage('<main>请登录</main>',url),/文章未提供完整正文/);
 assert.throws(()=>extractCapturePage(html({...article(),aweme_id:'1'}),url),/文章未提供完整正文/);
});

test('Flight payload also recognizes this article without executing JavaScript',()=>{
 const payload='a:'+JSON.stringify({article:article()})+'\n';const script='<script>self.__pace_f.push('+JSON.stringify([1,payload])+')</script>';assert.equal(extractCapturePage(script,url).capture_format,'douyin-article');assert.equal(globalThis.articleInjection,undefined);assert.throws(()=>extractCapturePage('<script>globalThis.articleInjection=true</script>',url));assert.equal(globalThis.articleInjection,undefined);
});

test('existing Douyin video and picture parsing retain their original types',()=>{
 const video={aweme_id:'1',desc:'视频',video:{play_addr:{url_list:['https://cdn.example/video.mp4']}}};assert.equal(extractCapturePage(html(video),'https://www.douyin.com/video/1').kind,'video');
 const image={aweme_id:'1',desc:'图片',images:[{url_list:['https://cdn.example/image.jpg']}]};assert.equal(extractCapturePage(html(image),'https://www.douyin.com/note/1').images.length,1);
});

for(const withImages of [false,true])test('article pipeline keeps one note and ordered local pictures despite group default: '+withImages,async()=>{
 const content=withImages?'文章开头\n\n![第一张](https://cdn.example/one.png)\n\n段落中间\n\n![第二张](https://cdn.example/two.png)\n\n文章结尾':'文章开头\n\n文章结尾',record=article(content),png=await sharp({create:{width:12,height:12,channels:3,background:'#aaaaaa'}}).png().toBuffer();
 const runtime=createApp({dataDir:await mkdtemp(resolve('artifacts/douyin-article-unit-')),captureOptions:{page:async()=>({url,type:'text/html',buffer:Buffer.from(html(record))}),image:async()=>png}});
 try{const input={text:url,image_mode:'group',request_id:'article:test'};assert.equal((await runtime.captures.resolve(input)).capture_format,'douyin-article');assert.equal(runtime.captures.list().length,0);const job=runtime.captures.add(input),done=await runtime.captures.wait(job.id,AbortSignal.timeout(10000));assert.equal(done.status,'completed');const rows=runtime.db.prepare('SELECT * FROM items').all(),notes=rows.filter(r=>r.kind==='note');assert.equal(notes.length,1);assert.equal(rows.filter(r=>r.kind==='video').length,0);assert.equal(notes[0].source_url,url);assert.match(notes[0].content,/文章开头[\s\S]*文章结尾/);assert.ok(!notes[0].content.includes('cdn.example'));assert.equal(rows.filter(r=>r.kind==='image').length,withImages?2:0);if(withImages){assert.match(notes[0].content,/第一张[\s\S]*段落中间[\s\S]*第二张/);assert.ok(rows.filter(r=>r.kind==='image').every(r=>r.group_key==='note:'+notes[0].id));}assert.equal(runtime.captures.add(input).id,job.id);assert.equal(runtime.captures.list().length,1);}
 finally{for(const key of ['captures','imports','trash','backups','webhooks','weixin','weixinNotifications'])await runtime[key]?.stop?.();runtime.db.close();}
});
