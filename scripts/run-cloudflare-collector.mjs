import{readFile,writeFile,mkdir,open,unlink}from'node:fs/promises';import{resolve,join}from'node:path';import{randomUUID}from'node:crypto';import{setTimeout as sleep}from'node:timers/promises';
import{createCollector,jsonClient}from'../addons/connectors/cloudflare/collector.js';import{publishRename}from'../server/atomic-files.js';
const dir=resolve(process.argv[2]||'data/cloudflare-collector');await mkdir(dir,{recursive:true});
const config=JSON.parse(await readFile(join(dir,'config.json'),'utf8'));
const lockPath=join(dir,'run.lock');let lock;
try{lock=await open(lockPath,'wx');}catch(error){if(error.code!=='EEXIST')throw error;const prior=JSON.parse(await readFile(lockPath,'utf8'));let active=true;try{process.kill(prior.pid,0);}catch(e){if(e.code==='ESRCH')active=false;else throw e;}if(active)throw Error('远程采集连接器已有进程运行');await unlink(lockPath);lock=await open(lockPath,'wx');}
await lock.writeFile(JSON.stringify({pid:process.pid,started_at:new Date().toISOString()}));await lock.close();
let state={jobs:[]};try{state=JSON.parse(await readFile(join(dir,'state.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
async function save(value){const temp=join(dir,'state-'+randomUUID()+'.tmp');await writeFile(temp,JSON.stringify(value),{mode:0o600});await publishRename(temp,join(dir,'state.json'),{replace:true});}
const collector=createCollector({local:jsonClient(config.local_origin,config.local_token),relay:jsonClient(config.relay_origin,config.connector_secret,{remote:true}),state,save});
let stopped=false,lastError='';process.on('SIGINT',()=>{stopped=true;});process.on('SIGTERM',()=>{stopped=true;});
try{while(!stopped){try{await collector.step();if(lastError)console.log('collector_connection_restored');lastError='';}catch(error){const code=error.status||error.code||'connection';if(String(code)!==lastError){console.error('collector_connection_failed '+code);lastError=String(code);}}await sleep(10000);}}
finally{await unlink(lockPath).catch(()=>{});}
