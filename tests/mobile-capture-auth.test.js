import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.js';

test('paired mobile capture survives browser expiry and remains revocable', async () => {
  const runtime=createApp({dataDir:await mkdtemp(join(tmpdir(),'znote-mobile-auth-')),captureOptions:{page:async()=>({url:'https://example.com/mobile-note',type:'text/html',buffer:Buffer.from('<html><head><title>手机授权验收</title></head><body><article><p>'+('手机采集学习笔记。'.repeat(60))+'</p></article></body></html>')})}});
  const server=runtime.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const base='http://127.0.0.1:'+server.address().port;
  const request=(path,headers={},data)=>fetch(base+path,{method:data?'POST':'GET',headers:{...headers,...(data?{'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):undefined});
  try {
    const setup=await request('/api/auth/setup',{}, {password:'mobile-auth-test'});
    const Cookie=setup.headers.get('set-cookie').split(';')[0];
    assert.equal((await request('/api/tokens',{}, {name:'未配对',scope:'write'})).status,401);
    const pairing=await request('/api/tokens',{Cookie},{name:'Android 手机采集',scope:'write'});assert.equal(pairing.status,201);
    const token=await pairing.json(),headers={Authorization:'Bearer '+token.token};
    runtime.db.prepare("UPDATE tokens SET expires_at='2000-01-01T00:00:00.000Z' WHERE kind='session'").run();
    assert.equal((await request('/api/collections',{Cookie})).status,401);
    assert.equal((await request('/api/collections',headers)).status,200);
    assert.equal((await request('/api/tokens',headers)).status,403);
    const capture=await request('/api/captures',headers,{text:'https://example.com/mobile-note',image_mode:'note'});assert.equal(capture.status,202);
    const job=await capture.json();let result;
    for(let i=0;i<50;i++){result=await(await request('/api/captures/'+job.id,headers)).json();if(['completed','failed'].includes(result.status))break;await new Promise(r=>setTimeout(r,50));}
    assert.equal(result.status,'completed',result.message);
    runtime.db.prepare('DELETE FROM tokens WHERE id=?').run(token.id);
    assert.equal((await request('/api/collections',headers)).status,401);
    assert.equal((await request('/api/captures/'+job.id,headers)).status,401);
  } finally {
    await Promise.all(['captures','weixin','trash','imports','backups','webhooks'].map(k=>runtime[k].stop()));
    await new Promise(r=>server.close(r));runtime.db.close();
  }
});
