import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {extractCapturePage} from '../server/capture-page.js';
import {extractJlijiGallery,jlijiSet} from '../server/capture-gallery.js';
import {createCaptureManager} from '../server/captures.js';
const source='https://www.jliji.com/set/2281';
const html=count=>`<div class="set-detail-page"><div class="set-detail-header"><h1>图集标题</h1><div class="set-detail-meta"><a class="set-category-link">作者</a><span>${count} / ${count} 张图片</span></div></div><div class="gallery-grid">${Array.from({length:count},(_,i)=>`<div class="gallery-item"><img data-set-id="2281" data-full="https://cdn.jliji.com/galleries/44/${i+1}.webp?key=signed" src="https://cdn.jliji.com/galleries/44/thumbs/${i+1}.jpg"></div>`).join('')}<img data-set-id="999" data-full="https://cdn.example/ad.jpg"></div><div class="related-sets"><img src="https://cdn.example/recommendation.jpg"></div></div>`;
test('gallery parser uses all originals in order, excludes other sets and defaults to group',()=>{
  const p=extractCapturePage(html(101),source);assert.equal(p.images.length,101);assert.equal(p.default_image_mode,'group');assert.equal(p.parser,'jliji-gallery-v1');assert.equal(p.images[100],'https://cdn.jliji.com/galleries/44/101.webp?key=signed');assert.ok(p.images.every(url=>!url.includes('thumbs')));assert.doesNotMatch(p.content,/!\[/);assert.match(p.content,/作者/);
  assert.equal(jlijiSet('https://jliji.com.evil.test/set/2281'),false);assert.equal(extractJlijiGallery(html(1),'https://jliji.com/'),null);
  assert.throws(()=>extractJlijiGallery(html(2).replace('data-full=','data-missing='),source),/原图列表缺失/);
  assert.throws(()=>extractJlijiGallery(html(2).replace('/2.webp','/1.webp'),source),/重复/);
  assert.throws(()=>extractJlijiGallery(html(2).replace('2 / 2 张','2 / 3 张'),source),/部分图集/);
  assert.throws(()=>extractJlijiGallery(html(1).replace('https://cdn.jliji.com/galleries/44/1.webp?key=signed','javascript:alert(1)'),source),/原图列表缺失/);
});
function harness(plan,seed){
  const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT)');if(seed)db.prepare('INSERT INTO settings VALUES(?,?)').run('mobile_captures_v1',JSON.stringify([seed]));
  const saved=new Map();let pages=0,attempts=0,failIndex=-1;
  const manager=createCaptureManager({db,dataDir:'unused',validateCollection:()=>{},work:fn=>fn(),exists:id=>saved.get(id),page:async()=>{pages++;return {plan}},image:async()=>Buffer.from('x'),saveImage:async(buffer,row)=>{attempts++;if(row.group_index===failIndex)throw Error('temporary');saved.set(row.id,row);return row;},saveNote:()=>{throw Error('Unexpected note');}});
  return {db,manager,saved,get pages(){return pages},get attempts(){return attempts},fail(index){failIndex=index},async close(){await manager.stop();db.close()}};
}
test('explicit group mode works for 201 Markdown-only images and retries without duplicates',async()=>{
  const plan={kind:'note',url:'https://example.com/gallery',title:'通用图集',content:Array.from({length:201},(_,i)=>`![${i}](https://cdn.example/${i}.jpg)`).join('\n')},h=harness(plan);
  try{h.fail(1);const job=h.manager.add({text:plan.url,image_mode:'group'});await assert.rejects(h.manager.wait(job.id,AbortSignal.timeout(5000)),/其他图片已继续处理/);assert.equal(h.saved.size,200);h.fail(-1);h.manager.retry(job.id);await h.manager.wait(job.id,AbortSignal.timeout(5000));assert.equal(h.saved.size,201);assert.equal(h.attempts,202);assert.ok([...h.saved.values()].every(row=>row.group_key&&row.content===plan.content));assert.equal(h.pages,1);}finally{await h.close()}
});
test('explicit note mode keeps the independent body limit and writes nothing on overflow',async()=>{
  const h=harness(extractCapturePage(html(101),source));try{const job=h.manager.add({text:source,image_mode:'note'});await assert.rejects(h.manager.wait(job.id,AbortSignal.timeout(5000)),/正文配图最多 100/);assert.equal(h.saved.size,0);}finally{await h.close()}
});
test('existing unsaved failed gallery reparses thumbnails on retry; all 101 originals become one group',async()=>{
  const seed={id:'264f86c6-d156-4364-a573-8b8f2c329907',source_url:source,input:{text:source,image_mode:'group',collection_id:null,tags:[]},status:'failed',plan:{kind:'note',url:source,content:'![old](https://cdn.example/thumb.jpg)'}},h=harness(extractCapturePage(html(101),source),seed);
  try{h.manager.retry(seed.id);await h.manager.wait(seed.id,AbortSignal.timeout(5000));assert.equal(h.pages,1);assert.equal(h.saved.size,101);assert.equal(new Set([...h.saved.values()].map(row=>row.group_key)).size,1);}finally{await h.close()}
});
test('legacy partially saved gallery retains its plan even if the first image failed',async()=>{
  const id='264f86c6-d156-4364-a573-8b8f2c329907',old={kind:'note',url:source,content:'![one](https://cdn.example/one.jpg)\n![two](https://cdn.example/two.jpg)'};
  const h=harness(extractCapturePage(html(101),source),{id,source_url:source,input:{text:source,image_mode:'group',collection_id:null,tags:[]},status:'failed',plan:old});
  const hash=createHash('sha256').update(id+':image:1').digest('hex'),second=`${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`;
  h.saved.set(second,{id:second,collection_id:null,group_index:1});
  // An old saved member with a different grouping must still be protected;
  // the retry may not erase it by swapping in the new original-image plan.
  try{h.manager.retry(id);await assert.rejects(h.manager.wait(id,AbortSignal.timeout(5000)),/重新分组/);assert.equal(h.pages,0);assert.equal(h.saved.get(second).group_index,1);}finally{await h.close()}
});
