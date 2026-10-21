import test from 'node:test';
import assert from 'node:assert/strict';
import {importVideoFormat} from '../server/imports.js';

test('Bilibili prefers an AVC MP4 stream before the HEVC-capable fallback',()=>{
  const format=importVideoFormat('https://www.bilibili.com/video/BV1GynB6JE7c/?p=1');
  assert.equal(format.split('/')[0],'bv[ext=mp4][vcodec^=avc1]+ba[ext=m4a]');
  assert.ok(format.endsWith('/bv[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b[ext=webm]/b'));
  assert.equal(importVideoFormat('https://m.bilibili.com/video/BV1GynB6JE7c'),format);
});
test('Other platforms and lookalike domains retain their existing format policy',()=>{
  for(const url of ['https://www.douyin.com/video/123','https://x.com/a/status/123','https://bilibili.com.example.org/video/123'])assert.equal(importVideoFormat(url),'bv[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b[ext=webm]/b');
});
