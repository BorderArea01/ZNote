import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {resolve} from 'node:path';
import sharp from 'sharp';
import {createApp} from '../server/app.js';
import {markdownImages,replaceMarkdownImages} from '../shared/markdown-images.js';
import {publicAddress,fetchRemoteImage} from '../server/remote-images.js';

test('Markdown images are rewritten without modifying hyperlinks, code or shared reference definitions',()=>{
 const md='![a](https://images.test/a.png "title")\n![b](<https://images.test/b.png>)\n![c][pic]\n\n[pic]: https://images.test/a.png\n\n[link][pic]\n`![example](https://images.test/code.png)`';
 const refs=markdownImages(md);assert.equal(refs.length,3);
 const result=replaceMarkdownImages(md,refs,new Map([['https://images.test/a.png','/media/a/original'],['https://images.test/b.png','/media/b/original']]));
 assert.equal(markdownImages(result).length,0);assert.ok(result.includes('[link][pic]'));assert.ok(result.includes('[pic]: https://images.test/a.png'));assert.ok(result.includes('`![example]'));
});
test('server-side image fetching rejects local addresses and unsafe URL schemes',async()=>{
 for(const ip of ['127.0.0.1','10.0.0.1','169.254.169.254','192.168.1.1','172.31.0.1','::1','::ffff:127.0.0.1','fc00::1','fe80::1'])assert.equal(publicAddress(ip),false,ip);
 assert.equal(publicAddress('8.8.8.8'),true);assert.equal(publicAddress('2606:4700:4700::1111'),true);
 await assert.rejects(fetchRemoteImage('http://127.0.0.1/secret'),/内网/);
 await assert.rejects(fetchRemoteImage('file:///etc/passwd'),/地址无效/);
});
test('notes archive originals, retry failures and keep collection scope; batch trash is atomic and recoverable',async()=>{
 const dir=await mkdtemp(resolve('artifacts/knowledge-v083-'));
 const png=await sharp({create:{width:12,height:12,channels:3,background:'#447766'}}).png().toBuffer();
 let fail=true;const runtime=createApp({dataDir:dir,imageDownload:async url=>{if(url.endsWith('missing.png')&&fail)throw Error('fixture missing');return png;}});
 const server=runtime.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
 let cookie='';const request=async(path,method='GET',body)=>{const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',Cookie:cookie,Origin:base},body:body?JSON.stringify(body):undefined});if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];const data=r.status===204?null:await r.json();return {status:r.status,data};};
 const post=async(path,body)=>{const r=await request(path,'POST',body);assert.ok(r.status<300,JSON.stringify(r.data));return r.data;};
 try{
  await post('/api/auth/setup',{password:'0830'});
  const a=await post('/api/collections',{name:'A'}),b=await post('/api/collections',{name:'B'});
  const note=await post('/api/items',{title:'A note',collection_id:a.id,tags:['A-only'],content:'![inline](https://images.test/ok.png)\n![ref][picture]\n\n[picture]: https://images.test/ok.png\n![bad](https://images.test/missing.png)'});
  assert.equal(note.image_archive.archived,1);assert.equal(note.image_archive.failures.length,1);assert.equal(markdownImages(note.content).length,1);assert.ok(note.content.includes('未归档'));
  const media=(await request(`/api/items?kind=image&collection=${a.id}`)).data;assert.equal(media.total,1);
  assert.deepEqual(Buffer.from(await (await fetch(base+media.items[0].url,{headers:{Cookie:cookie}})).arrayBuffer()),png);
  fail=false;const updated=await request('/api/items/'+note.id,'PATCH',{version:note.version,content:note.content});assert.equal(updated.status,200);assert.equal(markdownImages(updated.data.content).length,0);assert.ok(!updated.data.content.includes('znote-image-status'));
  const other=await post('/api/items',{title:'B note',collection_id:b.id,tags:['B-only'],favorite:true,content:'[[A note]]\n![x](https://images.test/ok.png)'});
  assert.equal((await request(`/api/items?collection=${b.id}`)).data.total,2);
  assert.equal((await request(`/api/items/${note.id}/backlinks`)).data.length,0);
  const tags=(await request(`/api/tags?collection=${a.id}`)).data;assert.ok(tags.every(t=>t.name!=='B-only'));
  assert.equal((await request(`/api/stats?collection=${a.id}`)).data.favorites,0);assert.equal((await request(`/api/stats?collection=${b.id}`)).data.favorites,1);
  const chosen=[updated.data,media.items[0]].map(({id,version})=>({id,version}));
  // Re-fetch versions because repeated source archival may update metadata.
  for(const item of chosen)item.version=(await request('/api/items/'+item.id)).data.version;
  const conflict=await request('/api/items/batch-trash','POST',{collection_id:a.id,items:[...chosen,{id:other.id,version:other.version}]});assert.equal(conflict.status,409);
  assert.equal((await request(`/api/stats?collection=${a.id}`)).data.trash,0);
  const deleted=await post('/api/items/batch-trash',{collection_id:a.id,items:chosen});assert.equal(deleted.items.length,2);
  assert.equal((await request(`/api/stats?collection=${b.id}`)).data.trash,0);assert.equal((await request(`/api/stats?collection=${a.id}`)).data.trash,2);
  await post('/api/items/batch-trash',{collection_id:a.id,restore:true,items:deleted.items.map(({id,version})=>({id,version}))});
  assert.equal((await request(`/api/stats?collection=${a.id}`)).data.trash,0);
 }finally{await runtime.imports.stop();await runtime.backups.stop();await runtime.webhooks.stop();await new Promise(r=>server.close(r));runtime.db.close();}
});
