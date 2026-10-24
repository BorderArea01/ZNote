import test from 'node:test';import assert from 'node:assert/strict';
import {extractCapturePage} from '../server/capture-page.js';import {extractComicChapter} from '../server/capture-comic.js';
const source='https://mangapill.com/chapters/9552-10001000/example-chapter-1';
const documentFor=(count=74)=>`<title>Example Chapter 1 - Mangapill</title><h1>Example Chapter 1</h1><picture><img data-src="https://cdn.example/cover.jpg"></picture>${Array.from({length:count},(_,i)=>`<chapter-page><div>page ${i+1}/${count}</div><picture><img class="js-page" data-src="https://cdn.readdetectiveconan.com/file/mangap/9552/10001000/key/${i+1}.jpeg?token=signed&amp;page=${i+1}" src="placeholder.gif"></picture></chapter-page>`).join('')}<a href="/chapters/9552-10002000/example-chapter-2">Next Chapter</a>`;
test('Mangapill keeps every lazy page in DOM order as one chapter group, with source remarks',()=>{
 const p=extractCapturePage(documentFor(),source);assert.equal(p.parser,'mangapill-chapter-v1');assert.equal(p.default_image_mode,'group');assert.equal(p.images.length,74);assert.equal(p.title,'Example Chapter 1');assert.match(p.content,/页数：74/);assert.ok(p.content.includes(source));
 assert.equal(p.images[0],'https://cdn.readdetectiveconan.com/file/mangap/9552/10001000/key/1.jpeg?token=signed&page=1');assert.ok(p.images[73].includes('/74.jpeg?'));assert.deepEqual(p.image_candidates,p.images.map(v=>[v]));assert.doesNotMatch(p.content,/Next Chapter|cover.jpg|placeholder/);
 assert.equal(extractComicChapter(documentFor(),source.replace('mangapill.com','mangapill.com.evil.test')),null);assert.equal(extractComicChapter(documentFor(),'https://mangapill.com/manga/9552/example'),null);
});
test('Mangapill rejects incomplete counters, missing images, duplicate URLs and invalid schemes',()=>{
 for(const html of [documentFor(2).replace('page 2/2','page 3/3'),documentFor(2).replace('page 1/2','page 1/3'),documentFor(2).replace(/<picture><img class="js-page"[^>]+><\/picture>/,''),documentFor(2).replace('/2.jpeg?token=signed&amp;page=2','/1.jpeg?token=signed&amp;page=1'),documentFor(1).replace('https://cdn.readdetectiveconan.com/file/mangap/9552/10001000/key/1.jpeg?token=signed&amp;page=1','javascript:alert(1)')])assert.throws(()=>extractComicChapter(html,source),/章节/);
 assert.throws(()=>extractComicChapter('<h1>Verify browser</h1>',source),/完整章节图片/);assert.throws(()=>extractComicChapter(documentFor(201),source),/200 页/);
});
