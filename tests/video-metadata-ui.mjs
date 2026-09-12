import {chromium} from 'playwright';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const browser=await chromium.launch({channel:'msedge',headless:true}),page=await browser.newPage(),script=await readFile('extensions/clipper/video-metadata.js','utf8');
try{
 const cases=[
  ['https://www.bilibili.com/video/BV1234','<h1 class="video-title">城市纪录</h1><a class="up-name" href="https://space.bilibili.com/123">摄影作者</a><video></video>','城市纪录','摄影作者','https://space.bilibili.com/123'],
  ['https://www.xiaohongshu.com/explore/abc','<div id="noteContainer"><div id="detail-title">光影笔记</div><div class="author-wrapper"><a class="name" href="/user/profile/123">小红书作者</a></div><video></video></div>','光影笔记','小红书作者','https://www.xiaohongshu.com/user/profile/123'],
  ['https://www.douyin.com/video/123','<div data-e2e="feed-active-video"><div data-e2e="video-desc">旅行影像</div><a data-e2e="video-author-nickname" href="/user/123">旅行作者</a><video></video></div>','旅行影像','旅行作者','https://www.douyin.com/user/123'],
  ['https://x.com/home','<article data-testid="tweet"><div data-testid="User-Name"><a href="/one">作者一</a></div><div data-testid="tweetText">第一部短片</div><a href="/one/status/123"><time>今天</time></a><video></video></article><article data-testid="tweet"><div data-testid="User-Name"><a href="/two">作者二</a></div><div data-testid="tweetText">第二部短片</div><a href="/two/status/456"><time>今天</time></a><video></video></article>','第一部短片','作者一','https://x.com/one'],
 ];
 for(const [url,html,title,author,authorUrl] of cases){await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:'<!doctype html><title>网站首页</title>'+html}));await page.goto(url);await page.evaluate(()=>{globalThis.chrome={runtime:{onMessage:{addListener(){}}}}});await page.addScriptTag({content:script});const result=await page.evaluate(()=>ZNoteVideoMetadata(document.querySelector('video')));assert.equal(result.title,title);assert.equal(result.author,author);assert.equal(result.author_url,authorUrl);if(url.includes('x.com')){assert.equal(result.source_url,'https://x.com/one/status/123');const next=await page.evaluate(()=>ZNoteVideoMetadata(document.querySelectorAll('video')[1]));assert.equal(next.author,'作者二');assert.equal(next.source_url,'https://x.com/two/status/456')}await page.unrouteAll();}
 console.log('PASS Bilibili, Xiaohongshu, Douyin detail metadata and independent X feed authors/permalinks in Edge DOM fixtures');
}finally{await browser.close()}
