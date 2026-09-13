import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import sharp from 'sharp';
import {mediaTools,runMediaCommand,importAuthor,platformUrl} from '../server/imports.js';
import {videoThumbnail} from '../server/video-thumbnail.js';
import {videoDetails} from '../shared/video-details.js';
import {addResource} from '../extensions/clipper/resource-store.js';

test('poster is the first decoded frame, bounded and does not modify source; decoder failure is explicit',async()=>{
 const dir=await mkdtemp(resolve('artifacts/video-poster-'));await mkdir(join(dir,'media'));const file=join(dir,'media','two-colors.mp4');
 await runMediaCommand(mediaTools().ffmpeg,['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=red:s=160x120:d=0.12:r=25','-f','lavfi','-i','color=c=blue:s=160x120:d=0.12:r=25','-filter_complex','[0:v][1:v]concat=n=2:v=1:a=0[v]','-map','[v]','-c:v','libx264','-pix_fmt','yuv420p',file]);
 const before=await readFile(file),poster=await videoThumbnail(dir,{file_key:'two-colors.mp4'}),stats=await sharp(poster).stats();assert.ok(stats.channels[0].mean>220&&stats.channels[2].mean<30,'first frame is red, later blue frame must not be the poster');assert.ok(poster.length<100000);assert.deepEqual(await readFile(file),before);
 await assert.rejects(videoThumbnail(dir,{file_key:'missing.mp4'}),e=>e.status===503&&e.message.includes('首帧'));
});
test('video metadata enrichment cannot be downgraded by network filenames and hover images are separate',()=>{
 const state={source_url:'https://site.test/feed',resources:[]};assert.equal(addResource(state,{url:'https://cdn.test/a.png'}),null);
 const item=addResource(state,{url:'https://cdn.test/a.mp4'});addResource(state,{url:item.url,title:'作品标题',author:'作者',author_url:'https://site.test/author',source_url:'https://site.test/post/1',metadata_rank:3});
 addResource(state,{url:item.url,title:'信息流首页',author:'其他作者',source_url:state.source_url,metadata_rank:1});assert.equal(item.title,'作品标题');assert.equal(item.author,'作者');assert.equal(item.source_url,'https://site.test/post/1');
 const hover={source_url:state.source_url,resources:[]};assert.ok(addResource(hover,{url:'https://cdn.test/a.png'},true));assert.equal(state.resources.length,1);
 const details=videoDetails({title:'作品',author:'作者 [甲]',author_url:'javascript:alert(1)'},['参考']);assert.equal(details.title,'作品');assert.deepEqual(details.tags,['作者 [甲]','参考']);assert.ok(details.content.includes('作者 \\[甲\\]'));assert.ok(!details.content.includes('javascript:'));
});

test('Douyin import prefers the display nickname over account handle',()=>{assert.equal(importAuthor({extractor_key:'Douyin',uploader:'account_123',channel:'作者昵称'}),'作者昵称');assert.equal(importAuthor({webpage_url:'https://www.douyin.com/video/123',uploader:'account_123',channel:'作者昵称'}),'作者昵称');assert.equal(importAuthor({extractor_key:'BiliBili',uploader:'原作者',channel:'频道'}),'原作者');assert.equal(importAuthor({extractor_key:'Douyin',uploader:'唯一作者'}),'唯一作者')});

test('Douyin favorites modal imports the work, never the profile',()=>{assert.equal(platformUrl('https://www.douyin.com/user/self?from_tab_name=main&modal_id=7684474331233527412&showTab=favorite_collection'),'https://www.douyin.com/video/7684474331233527412');for(const url of ['https://www.douyin.com/user/self','https://www.douyin.com/user/self?modal_id=invalid','https://www.douyin.com.evil.test/user/self?modal_id=123'])assert.throws(()=>platformUrl(url))});
