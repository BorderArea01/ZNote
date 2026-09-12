import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {resolve} from 'node:path';
import sharp from 'sharp';
import {createApp} from '../server/app.js';
import {sourceSite, sourceLinks} from '../shared/provenance.js';
import {withSource} from '../server/source.js';

test('source sites validate host boundaries, short links and exportable multi-source links', () => {
  for (const [url, site] of [['https://www.xiaohongshu.com/explore/1','小红书'], ['https://xhslink.com/a','小红书'], ['https://b23.tv/a','b站'], ['https://www.bilibili.com/video/a','b站'], ['https://v.douyin.com/a','抖音'], ['https://twitter.com/a/status/1','X'], ['https://x.com/a','X'], ['https://xiaohongshu.com.evil.test/a','xiaohongshu.com.evil.test']]) assert.equal(sourceSite(url), site);
  for (const url of ['javascript:alert(1)', 'https://user:password@example.org', '/relative']) assert.equal(sourceSite(url), null);
  assert.equal(sourceSite('https://' + 'a'.repeat(50) + '.org').length, 40);
  const item = withSource({source_url:'https://x.com/one', tags:['手工标签']});
  const next = withSource({...item, source_url:'https://b23.tv/two'});
  assert.deepEqual(next.tags, ['手工标签','X','b站']);
  assert.deepEqual(sourceLinks(next).map(x=>x.url), ['https://b23.tv/two','https://x.com/one']);
  assert.deepEqual(withSource(next),next);
  assert.throws(()=>withSource({source_url:'https://x.com',tags:Array.from({length:30},(_,i)=>'tag'+i)}), /留出一个位置/);
});

test('all image ingestion preserves original bytes and merges source tags without duplicate versions', async () => {
  const dir=await mkdtemp(resolve('artifacts/provenance-v07-')), runtime=createApp({dataDir:dir});
  const server=runtime.app.listen(0,'127.0.0.1'); await new Promise(r=>server.once('listening',r));
  const base=`http://127.0.0.1:${server.address().port}`;
  try {
    const setup=await fetch(base+'/api/auth/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'0712'})});
    const cookie=setup.headers.get('set-cookie').split(';')[0];
    const original=await sharp({create:{width:50,height:40,channels:3,background:'#ae6745'}}).png().toBuffer();
    const upload=async source=>{const data=new FormData();data.set('file',new Blob([original]),'page.png');data.set('tags','["参考"]');data.set('content','原备注');data.set('source_url',source);const r=await fetch(base+'/api/assets',{method:'POST',headers:{Cookie:cookie},body:data});assert.ok(r.ok);return r.json();};
    const first=await upload('https://www.xiaohongshu.com/explore/note1');
    assert.deepEqual(first.tags,['参考','小红书']);
    const second=await upload('https://www.bilibili.com/video/BV1');
    assert.equal(second.id,first.id); assert.equal(second.duplicate,true);
    assert.deepEqual(second.tags,['参考','小红书','b站']);
    assert.equal(second.source_url,first.source_url); assert.match(second.content,/原备注/);
    assert.equal(sourceLinks(second).length,2);
    const third=await upload('https://www.bilibili.com/video/BV1');assert.equal(third.version,second.version);
    const bytes=await fetch(base+first.url,{headers:{Cookie:cookie}});assert.deepEqual(Buffer.from(await bytes.arrayBuffer()),original);
  } finally {await runtime.imports.stop();await runtime.backups.stop();await runtime.webhooks.stop();await new Promise(r=>server.close(r));runtime.db.close();}
});
