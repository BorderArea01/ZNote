import assert from 'node:assert/strict';import {get} from 'node:https';import {createHash} from 'node:crypto';import {readFile,mkdtemp,writeFile} from 'node:fs/promises';import {resolve,join} from 'node:path';import {proxyAgent} from '../server/network-proxy.js';
if(!process.argv.includes('--live'))throw Error('Use --live to verify public release downloads');
const {relay_origin:origin}=JSON.parse(await readFile('data/cloudflare-collector/config.json','utf8'));
const download=(path,collect=false)=>new Promise((done,reject)=>{
 const hash=createHash('sha256'),chunks=[];let size=0;const request=get(new URL(path,origin),{agent:proxyAgent()},response=>{
  if(response.statusCode!==200){response.resume();reject(Error('Public release HTTP '+response.statusCode));return;}
  response.on('data',chunk=>{size+=chunk.length;if(size>(collect?32768:24*1024*1024)){response.destroy(Error('Release too large'));return;}hash.update(chunk);if(collect)chunks.push(chunk);});
  response.on('error',reject);response.on('end',()=>done({size,sha256:hash.digest('hex'),...(collect?{value:JSON.parse(Buffer.concat(chunks))}:{})}));
 });request.on('error',reject);request.setTimeout(30000,()=>request.destroy(Error('Public download timed out')));
});
const manifest=(await download('/downloads/latest.json',true)).value,result={origin,version:manifest.version,assets:[]};
for(const key of ['apk','source']){assert.match(manifest[key],/^\/downloads\/ZNote-[0-9.]+(?:-beta\.[0-9]+)?-(android\.apk|source\.zip)$/);const actual=await download(manifest[key]);assert.equal(actual.size,manifest[key+'_size']);assert.equal(actual.sha256,manifest[key+'_sha256']);result.assets.push({kind:key,...actual});}
const releaseDirectory=resolve(process.argv.find(a=>a.startsWith('--release-dir='))?.slice('--release-dir='.length)||'artifacts/android-beta21-release');
const receipt=JSON.parse(await readFile(join(releaseDirectory,'ANDROID-BUILD-SOURCE.json'),'utf8'));assert.equal(manifest.version,receipt.version);
const signed=await readFile(join(releaseDirectory,'ZNote-'+receipt.version+'-android.apk'));assert.equal(result.assets.find(a=>a.kind==='apk').sha256,createHash('sha256').update(signed).digest('hex'));
const dir=await mkdtemp(resolve('artifacts/cloudflare-release-live-'));await writeFile(join(dir,'result.json'),JSON.stringify(result,null,2));console.log('Public APK/source match signed release; evidence '+dir);
