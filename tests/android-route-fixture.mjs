import http from 'node:http';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash,randomUUID,scryptSync} from 'node:crypto';
import sharp from 'sharp';
import {createApp} from '../server/app.js';

const dataDir=await mkdtemp(resolve('artifacts/android-route-fixture-'));
const image=await sharp({create:{width:80,height:60,channels:3,background:'#78a7b0'}}).png().toBuffer();
const runtime=createApp({dataDir,captureOptions:{page:async url=>({plan:{url,kind:'note',title:'Android 路线验收',content:'原知识库采集队列端到端验收',images:['https://example.com/route.png']}}),image:async()=>image}});
const salt='1'.repeat(32);runtime.db.prepare('INSERT INTO settings VALUES(?,?)').run('password',salt+':'+scryptSync('route-test-0059',salt,64).toString('hex'));
runtime.db.prepare('INSERT INTO tokens VALUES(?,?,?,?,?,?,?)').run(randomUUID(),'route-test',createHash('sha256').update('zn_'+'a'.repeat(64)).digest('hex'),'write','api',new Date().toISOString(),null);
let mode='online';const stats={localSubmissions:0,remoteSubmissions:0,remoteRequests:0,credentialLeaks:0};
const send=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
const lan=http.createServer((req,res)=>{
 console.log('LAN',req.method,req.url.split('?')[0]);
 if(req.url.startsWith('/test/control')){const next=new URL(req.url,'http://localhost').searchParams.get('mode');if(next!=='stats')mode=next;return send(res,200,{...stats,mode,items:runtime.db.prepare('SELECT count(*) n FROM items').get().n});}
 if(req.headers.authorization&&req.headers.authorization!=='Bearer zn_'+'a'.repeat(64))stats.credentialLeaks++;
 if(req.url==='/api/health'&&mode==='offline')return send(res,503,{error:'LAN offline'});
 if(req.url==='/api/health'&&mode==='invalid')return send(res,200,{status:'ok',version:'1.0',mode:'remote-capture'});
 if(req.url==='/api/health'&&mode==='timeout'){setTimeout(()=>send(res,200,{status:'ok',version:'1.0'}),2000).unref();return;}
 if(req.url==='/api/me'&&mode==='unauthorized')return send(res,401,{error:'local credential revoked'});
 if(req.url==='/api/captures'&&req.method==='POST')stats.localSubmissions++;
 runtime.app(req,res);
});
const remote=http.createServer(async(req,res)=>{
 stats.remoteRequests++;
 if(req.url==='/'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});return res.end('<!doctype html><title>ZNote</title><h1>远程采集任务</h1>');}
 if(req.url==='/api/health')return send(res,200,{status:'ok',version:'1.0',mode:'remote-capture'});
 if(req.headers.authorization!=='Bearer zn_'+'b'.repeat(64)){if(req.headers.authorization)stats.credentialLeaks++;return send(res,401,{error:'wrong remote credential'});}
 if(req.url==='/api/collections')return send(res,200,{collections:[]});
 if(req.url==='/api/captures'&&req.method==='POST'){stats.remoteSubmissions++;for await(const chunk of req){}return send(res,202,{id:'remote-job-'+stats.remoteSubmissions});}
 if(req.url.startsWith('/api/captures/'))return send(res,200,{status:'completed',message:'测试采集已入库'});
 return send(res,404,{error:'not found'});
});
lan.listen(3842,'0.0.0.0');remote.listen(3843,'0.0.0.0');console.log('Routing fixture ready '+dataDir);
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await writeFile(join(dataDir,'routing-stats.json'),JSON.stringify(stats));lan.close();remote.close();await runtime.captures.stop();await runtime.backups.stop();await runtime.imports.stop();await runtime.webhooks.stop();runtime.db.close();process.exit(0);});
