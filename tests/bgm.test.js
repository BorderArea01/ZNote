import yauzl from 'yauzl';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,stat,copyFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {createApp} from '../server/app.js';
import {captureMusic} from '../server/capture-music.js';
import {extractCapturePage} from '../server/capture-page.js';
import {itemBgm} from '../server/bgm.js';
import {openDatabase} from '../server/db.js';
export function wave(seconds=12){const samples=16000*seconds,b=Buffer.alloc(44+samples*2);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(16000,24);b.writeUInt32LE(32000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(samples*2,40);return b;}
async function stop(r){await r.weixin.stop();await r.captures.stop();await r.imports.stop();await r.trash.stop();await r.backups.stop();await r.webhooks.stop();r.db.close();}
test('music extraction belongs to the matching work and ignores covers and recommendations',()=>{
  const current={aweme_id:'12345',desc:'音乐图组',images:[{url_list:['https://cdn.example/a.jpg']}],music:{title:'配乐',author:'作者',play_url:{url_list:['https://cdn.example/song.m4a']},cover_large:{url_list:['https://cdn.example/cover.jpg']}}};
  const other={...current,aweme_id:'54321',music:{play_url:{url_list:['https://cdn.example/wrong.mp3']}}};
  const plan=extractCapturePage('<script>window._ROUTER_DATA='+JSON.stringify({aweme_details:[other,current]})+'</script>','https://www.douyin.com/note/12345');
  assert.deepEqual(plan.bgm,{urls:['https://cdn.example/song.m4a'],title:'配乐',author:'作者'});
  assert.equal(captureMusic({music:{cover:'https://cdn.example/cover.jpg'}},'https://example.com'),null);
  assert.equal(captureMusic({music:{playUrl:'https://name:password@example.com/private'}},'https://example.com'),null);
  assert.equal(captureMusic({musicInfo:{musicName:'曲名',authorName:'歌手',playUrl:'//cdn.example/music.mp3'}},'https://www.xiaohongshu.com').title,'曲名');
});
test('schema 13 adds BGM without changing cards and reopens idempotently',async()=>{
  const dir=await mkdtemp(resolve('artifacts/bgm-migration-'));let db=openDatabase(dir);db.exec('ALTER TABLE items DROP COLUMN bgm; PRAGMA user_version=13');const id=randomUUID();db.prepare("INSERT INTO items(id,kind,title,created_at,updated_at) VALUES(?,'note','旧笔记','2026-10-11','2026-10-11')").run(id);const before=db.prepare('SELECT * FROM items').get();db.close();db=openDatabase(dir);assert.equal(db.prepare('PRAGMA user_version').get().user_version,15);const {bgm,...after}=db.prepare('SELECT * FROM items').get();assert.equal(bgm,null);assert.deepEqual(after,{...before});db.close();db=openDatabase(dir);assert.equal(db.prepare('SELECT count(*) n FROM items').get().n,1);db.close();
});
test('BGM failure does not fail albums, retry saves only audio; media, groups, copies and backups preserve attachments',async t=>{
  const dir=await mkdtemp(resolve('artifacts/bgm-api-')),audio=wave(),png=await sharp({create:{width:64,height:48,channels:3,background:'#28758b'}}).png().toBuffer();let imageCalls=0,musicCalls=0,failMusic=true;
  const plan={kind:'note',url:'https://www.douyin.com/note/12345',title:'配乐图组',content:'正文',images:['https://cdn.example/a.jpg','https://cdn.example/b.jpg'],bgm:{urls:['https://cdn.example/music.wav'],title:'作品配乐',author:'原作者'}};
  const runtime=createApp({dataDir:dir,captureOptions:{page:async()=>({plan}),image:async()=>{imageCalls++;return png;},captureBgm:async({dir:target})=>{musicCalls++;if(failMusic)throw Object.assign(Error('平台配乐暂不可用'),{status:422});const path=join(target,'music.wav');await writeFile(path,audio);return {path};}}});
  const server=runtime.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(async()=>{await new Promise(r=>server.close(r));await stop(runtime);});const base='http://127.0.0.1:'+server.address().port;
  const setup=await fetch(base+'/api/auth/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'1234'})}),cookie=setup.headers.get('set-cookie').split(';')[0];
  const req=(path,method='GET',body)=>fetch(base+path,{method,headers:{Cookie:cookie,...(body instanceof FormData?{}:{'Content-Type':'application/json'})},body:body instanceof FormData?body:body?JSON.stringify(body):undefined});
  const json=async(...args)=>{const r=await req(...args);assert.ok(r.ok,await r.clone().text());return r.json();};
  const job=await json('/api/captures','POST',{text:plan.url,image_mode:'group',request_id:'music-test'});const done=await runtime.captures.wait(job.id,AbortSignal.timeout(10000));assert.equal(done.bgm_status,'failed');assert.match(done.message,/配乐暂不可用/);assert.equal(imageCalls,2);assert.equal(runtime.db.prepare('SELECT count(*) n FROM items').get().n,2);
  failMusic=false;await json('/api/captures/'+job.id+'/retry','POST',{});const saved=await runtime.captures.wait(job.id,AbortSignal.timeout(10000));assert.equal(saved.bgm_status,'saved');assert.equal(imageCalls,2);assert.equal(musicCalls,2);
  const rows=runtime.db.prepare('SELECT * FROM items').all(),track=itemBgm(rows[0]);assert.ok(rows.every(row=>row.bgm===rows[0].bgm));assert.deepEqual(await readFile(join(dir,'media',track.file_key)),audio);
  let first=await json('/api/items/'+done.item_id);assert.equal(first.bgm.title,'作品配乐');assert.equal(first.bgm.file_key,undefined);assert.equal(first.group_size,2);
  assert.equal((await fetch(base+first.bgm.url)).status,401);const range=await fetch(base+first.bgm.url,{headers:{Cookie:cookie,Range:'bytes=0-43'}});assert.equal(range.status,206);assert.deepEqual(Buffer.from(await range.arrayBuffer()),audio.subarray(0,44));assert.equal(range.headers.get('content-type'),'audio/wav');assert.equal((await fetch(base+first.bgm.url,{method:'HEAD',headers:{Cookie:cookie}})).headers.get('content-length'),String(audio.length));
  const form=new FormData();form.set('file',new Blob(['<html>not audio</html>']),'invalid.mp3');form.set('version',first.version);assert.equal((await req('/api/items/'+first.id+'/bgm','POST',form)).status,415);assert.equal((await json('/api/items/'+first.id)).bgm.hash,track.hash);
  assert.equal((await req('/api/items/'+first.id+'/bgm','DELETE',{version:first.version-1})).status,409);
  const stats=await json('/api/storage');assert.equal(stats.bgm_files,1);assert.equal(stats.bgm_bytes,audio.length);
  const snapshot=await runtime.backups.run();const snapshotFile=join(dir,'backups',snapshot.id,'data','media',track.file_key);assert.equal((await stat(snapshotFile)).size,audio.length);
  const portable=await req('/api/export?mode=portable');assert.equal(portable.status,200);const zip=Buffer.from(await portable.arrayBuffer());assert.ok(zip.includes(Buffer.from('配乐/')),'portable export includes the audio attachment');
  const backupResponse=await req('/api/export?mode=backup'),backupPath=join(dir,'migration.zip');assert.equal(backupResponse.status,200);await writeFile(backupPath,Buffer.from(await backupResponse.arrayBuffer()));
  const restored=createApp({dataDir:join(dir,'restored')});try{const preview=await restored.backups.preview(backupPath);await restored.backups.restore(preview.id);const restoredRow=restored.db.prepare('SELECT * FROM items WHERE id=?').get(first.id),restoredTrack=itemBgm(restoredRow);assert.notEqual(restoredTrack.file_key,track.file_key);assert.deepEqual(await readFile(join(dir,'restored','media',restoredTrack.file_key)),audio);assert.equal(restored.db.prepare('SELECT count(DISTINCT bgm) n FROM items').get().n,1);}finally{await stop(restored);}
  const library=await json('/api/collections','POST',{name:'配乐复用'}),copy=await json('/api/items/'+first.id+'/copy','POST',{collection_id:library.id});assert.equal(copy.bgm.hash,track.hash);
  const readToken=await json('/api/tokens','POST',{name:'配乐只读验收',scope:'read'});assert.equal((await fetch(base+'/api/items/'+first.id+'/bgm',{method:'DELETE',headers:{Authorization:'Bearer '+readToken.token,'Content-Type':'application/json'},body:JSON.stringify({version:first.version})})).status,403);
  await json('/api/items/'+first.id+'/bgm','DELETE',{version:first.version});assert.ok(runtime.db.prepare('SELECT * FROM items WHERE collection_id IS NULL').all().every(r=>r.bgm===null));await runtime.trash.cleanup();assert.equal((await stat(join(dir,'media',track.file_key))).size,audio.length,'copied card protects the shared audio');
  await json('/api/items/'+copy.id+'/bgm','DELETE',{version:copy.version});await runtime.trash.cleanup();await assert.rejects(stat(join(dir,'media',track.file_key)),{code:'ENOENT'});assert.ok((await stat(snapshotFile)).size===audio.length,'snapshot hardlink preserves removed music');
});

 test('BGM accompanies plain videos, every live-video member and notes with local illustrations',async t=>{
  const dir=await mkdtemp(resolve('artifacts/bgm-kinds-')),audio=wave(),png=await sharp({create:{width:20,height:30,channels:3,background:'#485b71'}}).png().toBuffer();
  const music={urls:['https://cdn.example/song.wav'],title:'同一首配乐',author:'作者'};
  const runtime=createApp({dataDir:dir,captureOptions:{page:async url=>({plan:url.endsWith('/video')?{kind:'video',url,title:'视频',video_urls:['https://cdn.example/video.mp4'],bgm:{...music,title:'视频配乐'}}:url.endsWith('/live')?{kind:'note',url,title:'实况图组',images:[],live_videos:[{index:0,urls:['https://cdn.example/one.mp4']},{index:1,urls:['https://cdn.example/two.mp4']}],bgm:music}:{kind:'note',url,title:'图文',content:'正文',images:['https://cdn.example/one.png'],bgm:music}}),image:async()=>png,captureVideo:async({dir:target,plan})=>{const path=join(target,'video.mp4');await copyFile(plan.video_urls?.[0]?.includes('two')?'tests/fixtures/sample.mkv':'tests/fixtures/sample.mp4',path);return {path,originalname:'sample.mp4',title:plan.title};},captureBgm:async({dir:target})=>{const path=join(target,'song.wav');await writeFile(path,audio);return {path};}}});t.after(()=>stop(runtime));
  for(const suffix of ['video','live','note']){const collection=randomUUID();runtime.db.prepare('INSERT INTO collections(id,name,created_at) VALUES(?,?,?)').run(collection,suffix,new Date().toISOString());const job=runtime.captures.add({text:'https://example.com/'+suffix,collection_id:collection,image_mode:'note'}),done=await runtime.captures.wait(job.id,AbortSignal.timeout(10000));assert.equal(done.bgm_status,'saved');const rows=runtime.db.prepare('SELECT * FROM items WHERE collection_id=?').all(collection);assert.equal(rows.length,suffix==='video'?1:2);assert.ok(rows.every(row=>row.bgm));assert.equal(new Set(rows.map(row=>itemBgm(row).file_key)).size,1);if(suffix==='live')assert.ok(rows.every(row=>row.kind==='video'));if(suffix==='note')assert.equal(rows.find(row=>row.id===done.item_id).kind,'note');}
  assert.equal(new Set(runtime.db.prepare('SELECT bgm FROM items').all().map(row=>itemBgm(row).file_key)).size,1,'identical audio is stored once across works');
  const server=runtime.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));try{const base='http://127.0.0.1:'+server.address().port,setup=await fetch(base+'/api/auth/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'1234'})}),cookie=setup.headers.get('set-cookie').split(';')[0];const exported=await fetch(base+'/api/export?mode=portable',{headers:{Cookie:cookie}}),buffer=Buffer.from(await exported.arrayBuffer());assert.equal(exported.status,200);
    const files=await new Promise((resolve,reject)=>yauzl.fromBuffer(buffer,{lazyEntries:true},(error,zip)=>{if(error)return reject(error);const files=new Map();zip.on('error',reject);zip.on('entry',entry=>zip.openReadStream(entry,(error,stream)=>{if(error)return reject(error);const chunks=[];stream.on('error',reject);stream.on('data',chunk=>chunks.push(chunk));stream.on('end',()=>{files.set(entry.fileName,Buffer.concat(chunks));zip.readEntry();});}));zip.on('end',()=>resolve(files));zip.readEntry();}));const manifest=JSON.parse(files.get('manifest.json'));assert.equal([...files.keys()].filter(name=>name.startsWith('配乐/')).length,1);assert.ok(manifest.items.every(item=>files.has(item.bgm.file)),'different track titles still refer to the single archived audio');
  }finally{await new Promise(r=>server.close(r));}

 });
