import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {extractCapturePage} from '../server/capture-page.js';
import {extractComicChapter} from '../server/capture-comic.js';
import {createCaptureManager} from '../server/captures.js';

const source='https://www.kxmh8.com/comic117807/chapter0.html';
const documentFor=count=>`<title>站点标题</title><img src="https://cdn.example/ad.jpg"><div class="single"><h1>章节标题</h1><a href="chapter1.html">下一话</a><div class="font_max">${Array.from({length:count},(_,i)=>`<img class="comic_img lazy" data-original="https://cdn.example/${i+1}.webp?verify=expires-signature&amp;page=${i+1}" src="placeholder.gif">`).join('')}</div></div>`;
test('comic chapters retain all signed URLs in reading order and exclude navigation/ads',()=>{
  const plan=extractCapturePage(documentFor(175),source);
  assert.equal(plan.title,'章节标题');assert.equal(plan.images.length,175);
  assert.equal(plan.default_image_mode,'group');assert.equal(plan.url,source);
  assert.equal(plan.images[0],'https://cdn.example/1.webp?verify=expires-signature&page=1');
  assert.equal(plan.images[174],'https://cdn.example/175.webp?verify=expires-signature&page=175');
  assert.deepEqual(plan.image_candidates,plan.images.map(url=>[url]));
  assert.doesNotMatch(plan.content,/下一话|placeholder|ad.jpg/);
  for(const host of ['kxmh8.cc','www.kxmh8.top'])assert.equal(extractComicChapter(documentFor(1),source.replace('www.kxmh8.com',host)).images.length,1);
  assert.equal(extractComicChapter(documentFor(1),source.replace('kxmh8.com','kxmh8.com.evil.test')),null);
  assert.equal(extractComicChapter(documentFor(1),source.replace('chapter0.html','')),null);
});
test('comic parser refuses missing, repeated, invalid and oversized chapters',()=>{
  assert.throws(()=>extractComicChapter(documentFor(0),source),/尚未提供/);
  assert.throws(()=>extractComicChapter(documentFor(201),source),/200 页/);
  assert.throws(()=>extractComicChapter(documentFor(2).replace('/2.webp','/1.webp').replace('page=2','page=1'),source),/缺失或重复/);
  assert.throws(()=>extractComicChapter(documentFor(1).replace('https://cdn.example/1.webp?verify=expires-signature&amp;page=1','javascript:alert(1)'),source),/缺失或重复/);
});
for(const count of [1,175,200])test(`comic default group saves ${count} pages, continues failures and resumes without duplicates`,async()=>{
  const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT)');
  const plan=extractCapturePage(documentFor(count),source),saved=new Map();let fail=count>1,attempts=0;
  const manager=createCaptureManager({db,dataDir:'unused',validateCollection:()=>{},work:fn=>fn(),exists:id=>saved.get(id),page:async()=>({plan}),image:async()=>Buffer.from('image'),saveImage:async(buffer,item)=>{attempts++;if(fail&&item.group_index===1)throw Error('临时下载失败');saved.set(item.id,item);return item;},saveNote:()=>{throw Error('Unexpected extra note');}});
  try{
    const job=manager.add({text:source,collection_id:'target'});
    if(fail){await assert.rejects(manager.wait(job.id,AbortSignal.timeout(10000)),/其他图片已继续处理/);assert.equal(saved.size,count-1);fail=false;manager.retry(job.id);}
    const done=await manager.wait(job.id,AbortSignal.timeout(10000));assert.equal(saved.size,count);assert.equal(attempts,count+(count>1?1:0));
    const rows=[...saved.values()].sort((a,b)=>a.group_index-b.group_index);assert.equal(done.item_id,rows[0].id);
    assert.deepEqual(rows.map(row=>row.group_index),Array.from({length:count},(_,i)=>i));
    assert.ok(rows.every(row=>row.source_url===source&&row.content===plan.content&&row.collection_id==='target'));
    assert.equal(new Set(rows.map(row=>row.group_key)).size,1);assert.equal(Boolean(rows[0].group_key),count>1);
  }finally{await manager.stop();db.close();}
});
test('explicit note mode retains its 100-image boundary',async()=>{
  const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT)');
  const manager=createCaptureManager({db,dataDir:'unused',validateCollection:()=>{},work:fn=>fn(),exists:()=>null,page:async()=>({plan:extractCapturePage(documentFor(175),source)}),saveImage:()=>{throw Error('Must fail before writing');}});
  try{const job=manager.add({text:source,image_mode:'note'});await assert.rejects(manager.wait(job.id,AbortSignal.timeout(5000)),/正文配图最多 100 张/);}finally{await manager.stop();db.close();}
});
