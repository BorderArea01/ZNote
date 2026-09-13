// Only attaches artifacts from successful platform jobs to an existing draft.
// Publication remains a separate operation after APK signing and release review.
import {spawnSync} from 'node:child_process';
import {mkdir,readdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const repo=process.env.RELEASE_REPO,tag=process.env.RELEASE_TAG;
assert.match(repo||'',/^[\w.-]+\/[\w.-]+$/);assert.match(tag||'',/^v\d+\.\d+\.\d+(?:-[\w.]+)?$/);
function gh(args){const r=spawnSync('gh',args,{encoding:'utf8',maxBuffer:5e6});if(r.status!==0)throw Error(r.stderr.slice(0,1000));return r.stdout;}
const api=path=>JSON.parse(gh(['api','repos/'+repo+'/'+path]));
const draft=JSON.parse(gh(['release','view',tag,'--repo',repo,'--json','databaseId,isDraft']));assert.equal(draft.isDraft,true,'Target must be an existing draft');
const source=[];
for(const [key,runName,artifact,jobName] of [
 ['windows','WINDOWS_RUN','desktop-windows-latest','desktop (windows-latest)'],
 ['mac-intel','INTEL_RUN','desktop-macos-15-intel','desktop (macos-15-intel)'],
 ['mac-arm','ARM_RUN','desktop-macos-15','desktop (macos-15)'],
]){
 const run=process.env[runName];assert.match(run||'',/^\d+$/);
 const build=api('actions/runs/'+run);assert.equal(build.path,'.github/workflows/clients.yml');
 const job=api('actions/runs/'+run+'/jobs?per_page=100').jobs.find(j=>j.name===jobName);assert.equal(job?.conclusion,'success',key+' job must have passed its packaged-client smoke test');
 const dir=join('artifacts','release-upload',key);await mkdir(dir,{recursive:true});
 gh(['run','download',run,'--repo',repo,'--name',artifact,'--dir',dir]);
 const files=(await readdir(dir)).filter(f=>f.startsWith('ZNote-'+tag.slice(1)+'-')&&/\.(exe|zip|dmg)$/.test(f));assert.equal(files.length,2,'Expected installer and archive');
 const item={platform:key,run:Number(run),commit:build.head_sha,source:'https://github.com/'+repo+'/archive/'+build.head_sha+'.zip',files:[]};
 for(const file of files){const path=join(dir,file),sha256=createHash('sha256').update(await readFile(path)).digest('hex');const existing=api('releases/'+draft.databaseId+'/assets?per_page=100').find(a=>a.name===file);if(existing)assert.equal(existing.digest,'sha256:'+sha256,'Existing release asset differs');else gh(['release','upload',tag,path,'--repo',repo]);const uploaded=api('releases/'+draft.databaseId+'/assets?per_page=100').find(a=>a.name===file);assert.equal(uploaded?.digest,'sha256:'+sha256,'Uploaded bytes must match build');item.files.push({name:file,sha256});console.log('Verified and attached '+file);}
 source.push(item);
}
await writeFile('artifacts/DESKTOP-BUILD-SOURCES.json',JSON.stringify(source,null,2)+'\n');
const existing=api('releases/'+draft.databaseId+'/assets?per_page=100').find(a=>a.name==='DESKTOP-BUILD-SOURCES.json');
if(!existing)gh(['release','upload',tag,'artifacts/DESKTOP-BUILD-SOURCES.json','--repo',repo]);
console.log('Draft assets attached; release has not been published.');
