import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,link,rename,unlink,readFile,readdir,open,stat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import sharp from 'sharp';
import {createApp} from '../server/app.js';
import {measureBackupSpace,assertBackupBudget} from '../server/backup-space.js';

test('physical space counts shared files across renamed live keys and deduplicates retained media',async()=>{
  const dir=await mkdtemp(resolve('artifacts/backup-space-'));
  await mkdir(join(dir,'media'));await writeFile(join(dir,'media','original'),Buffer.alloc(1024));
  const entries=[];
  for(const id of ['one','two']){
    const folder=join(dir,'backups',id);await mkdir(join(folder,'data/media'),{recursive:true});
    for(const name of ['data/znote.sqlite','snapshot.json','RESTORE.txt'])await writeFile(join(folder,name),'meta');
    await link(join(dir,'media','original'),join(folder,'data/media','original'));entries.push({id,format:'snapshot'});
  }
  await rename(join(dir,'media','original'),join(dir,'media','restored-key'));
  let space=await measureBackupSpace(dir,entries);assert.equal(space.shared_media_bytes,1024);assert.equal(space.additional_bytes,24);
  await unlink(join(dir,'media','restored-key'));
  space=await measureBackupSpace(dir,entries);assert.equal(space.retained_media_bytes,1024);assert.equal(space.additional_bytes,1048);
  await writeFile(join(dir,'media','original'),'new');
  space=await measureBackupSpace(dir,entries);assert.equal(space.copied_media_bytes,1024);assert.equal(space.additional_bytes,1048);
  assert.throws(()=>assertBackupBudget(1048,1047),{status:507});assert.doesNotThrow(()=>assertBackupBudget(1048,1048));
});

test('snapshot fails closed on link, quota and low disk errors; preserves recovery point and recovers',async t=>{
  const dir=await mkdtemp(resolve('artifacts/backup-limit-'));let linkError=null,links=0,lowDisk=false,failLinkAt=0,diskCalls=0,failDiskAt=0;
  const runtime=createApp({dataDir:dir,backupOptions:{linkMedia:async(a,b)=>{links++;if(linkError||links===failLinkAt)throw Object.assign(Error('injected'),{code:linkError||'EPERM'});await link(a,b);},diskInspect:async()=>({bsize:4096,bavail:lowDisk||++diskCalls===failDiskAt?1:1e9})}});
  const server=runtime.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  t.after(async()=>{await runtime.backups.stop();await new Promise(r=>server.close(r));runtime.db.close();});
  const base=`http://127.0.0.1:${server.address().port}`;let cookie='';
  const req=(path,method='GET',body)=>fetch(base+path,{method,headers:{Cookie:cookie,...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
  const json=async(path,method,body)=>{const r=await req(path,method,body);assert.ok(r.ok,await r.clone().text());return r.json();};
  const setup=await req('/api/auth/setup','POST',{password:'0097'});cookie=setup.headers.get('set-cookie').split(';')[0];
  let status=await json('/api/backups');assert.equal(status.keep,1);assert.equal(status.max_extra_mb,1024);
  const form=new FormData();form.set('file',new Blob([await sharp({create:{width:32,height:32,channels:3,background:'#38785b'}}).png().toBuffer()]),'test.png');
  const uploaded=await fetch(base+'/api/assets',{method:'POST',headers:{Cookie:cookie},body:form});assert.ok(uploaded.ok);
  const first=await json('/api/backups','POST',{}),original=await readFile(join(dir,'backups',first.id,'snapshot.json'));
  const unchanged=async()=>{assert.deepEqual(await readFile(join(dir,'backups',first.id,'snapshot.json')),original);assert.equal((await readdir(join(dir,'backups'))).filter(n=>n.endsWith('.tmp')).length,0);};
  for(const code of ['EXDEV','EPERM']){linkError=code;const r=await req('/api/backups','POST',{});assert.equal(r.status,507);assert.match((await r.json()).error,/未复制原文件/);await unchanged();assert.match((await json('/api/backups')).last_error,/未复制原文件/);}
  linkError=null;lowDisk=true;links=0;assert.equal((await req('/api/backups','POST',{})).status,507);assert.equal(links,0);await unchanged();lowDisk=false;
  links=0;failLinkAt=2;assert.equal((await req('/api/backups','POST',{})).status,507);assert.equal(links,2);await unchanged();failLinkAt=0;
  diskCalls=0;failDiskAt=2;assert.equal((await req('/api/backups','POST',{})).status,507);await unchanged();failDiskAt=0;
  await json('/api/backups/policy','PATCH',{enabled:false,interval_hours:24,keep:1,max_extra_mb:64});
  assert.equal((await req('/api/backups/policy','PATCH',{enabled:false,interval_hours:24,keep:1,max_extra_mb:63})).status,400);
  const legacy=join(dir,'backups','1790000000000-00000000-0000-4000-8000-000000000000.zip');const h=await open(legacy,'w');await h.truncate(64*1024**2);await h.close();
  status=await json('/api/backups?refresh_space=true');assert.ok(status.over_budget);links=0;
  const quota=await req('/api/backups','POST',{});assert.equal(quota.status,507);assert.match((await quota.json()).error,/容量上限/);assert.equal(links,0);await unchanged();assert.equal((await stat(legacy)).size,64*1024**2);
  await unlink(legacy);await json('/api/backups/policy','PATCH',{enabled:false,interval_hours:24,keep:1,max_extra_mb:1024});
  await json('/api/backups/policy','PATCH',{enabled:false,interval_hours:2,keep:1});assert.equal((await json('/api/backups')).max_extra_mb,1024);
  const next=await json('/api/backups','POST',{});status=await json('/api/backups?refresh_space=true');assert.equal(status.backups.length,1);assert.equal(status.backups[0].id,next.id);assert.equal(status.backups[0].copied_files,0);assert.equal(status.backups[0].linked_files,1);assert.equal(status.last_error,null);assert.equal(status.space.shared_media_bytes>0,true);assert.equal(status.stored_bytes,status.space.metadata_bytes);
  const persisted=JSON.parse(await readFile(join(dir,'backups','policy.json')));assert.equal(persisted.keep,1);assert.equal(persisted.max_extra_mb,1024);
});
