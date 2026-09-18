import test from 'node:test';
import assert from 'node:assert/strict';
import {allowedCaptureRequest,douyinWork,douyinAwemeEndpoint,hasCaptureResources,renderDouyinCapture} from '../server/capture-browser.js';
test('on-demand renderer only accepts platform requests and exact work links',()=>{
  assert.equal(douyinWork('https://www.douyin.com/video/123'),'123');
  assert.equal(douyinWork('https://www.iesdouyin.com/share/slides/123/'),'123');
  assert.equal(douyinWork('https://www.douyin.com/user/self?modal_id=123'),'123');
  assert.equal(douyinWork('https://douyin.com.evil.test/video/123'),'');
  assert.equal(douyinAwemeEndpoint('https://www.douyin.com/aweme/v1/web/aweme/detail/'),'detail');
  assert.equal(douyinAwemeEndpoint('https://www-hj.douyin.com/aweme/v1/web/aweme/detail/'),'detail');
  assert.equal(douyinAwemeEndpoint('https://www.iesdouyin.com/web/api/v2/aweme/slidesinfo'),'slides');
  assert.equal(douyinAwemeEndpoint('https://douyin.com.evil.test/aweme/v1/web/aweme/detail/'),'');
  assert.equal(hasCaptureResources({kind:'video',url:'https://www.douyin.com/video/123'}),false);
  assert.equal(hasCaptureResources({kind:'video',video_urls:['https://cdn.example/video.mp4']}),true);
  assert.equal(hasCaptureResources({kind:'note',images:['https://cdn.example/image.jpg']}),true);
  assert.ok(allowedCaptureRequest('https://www.douyin.com/aweme/v1/web/aweme/detail/','fetch'));
  assert.ok(allowedCaptureRequest('https://www.iesdouyin.com/web/api/v2/aweme/slidesinfo/','xhr'));
  assert.ok(allowedCaptureRequest('https://www.iesdouyin.com/web/api/v2/aweme/slidesinfo','xhr'));
  for(const url of ['http://localhost/api','http://192.168.1.1/','https://douyin.com.evil.test/','file:///a','https://user:pass@www.douyin.com/','https://www.douyin.com:3000/'])assert.equal(allowedCaptureRequest(url,'fetch'),false);
  for(const type of ['image','media','font'])assert.equal(allowedCaptureRequest('https://www.douyin.com/file',type),false);
});
test('cancelled capture does not start a browser',async()=>{
  const controller=new AbortController();controller.abort();await assert.rejects(renderDouyinCapture('https://www.douyin.com/video/123',controller.signal),{name:'AbortError'});
  await assert.rejects(renderDouyinCapture('https://example.com/video/123',new AbortController().signal),/具体作品/);
});
