import{DatabaseSync}from'node:sqlite';import{readFile,writeFile,mkdir}from'node:fs/promises';import{resolve,join,dirname}from'node:path';import{fileURLToPath}from'node:url';import{randomBytes,randomUUID,createHash}from'node:crypto';import{execFileSync}from'node:child_process';
import{publishRename}from'../../../server/atomic-files.js';import{jsonClient}from'./collector.js';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..'),dir=join(root,'data/cloudflare-collector'),configPath=join(dir,'config.json'),workerPath=join(dir,'wrangler.json');
async function write(path,value){const temp=path+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify(value,null,2),{mode:0o600});await publishRename(temp,path,{replace:true});}
const [command,...args]=process.argv.slice(2);
if(command==='init'){
 const [account,database]=args;if(!/^[a-f0-9]{32}$/.test(account||'')||!/^[a-f0-9-]{36}$/.test(database||''))throw Error('Usage: init <account-id> <database-id>');
 await mkdir(dir,{recursive:true});let config;try{config=JSON.parse(await readFile(configPath,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 if(config)throw Error('Collector already configured; inspect it before replacing credentials');
 const db=new DatabaseSync(join(root,'data/znote.sqlite'));db.exec('PRAGMA busy_timeout=5000');try{
  if(!db.prepare("SELECT value FROM settings WHERE key='password'").get())throw Error('Set up the existing ZNote login before configuring remote capture');
  const raw='zn_'+randomBytes(32).toString('hex'),id=randomUUID();
  config={local_origin:'http://127.0.0.1:3741',local_token:raw,local_token_id:id,relay_origin:null,connector_secret:randomBytes(32).toString('hex')};
  db.prepare('INSERT INTO tokens(id,name,hash,scope,kind,created_at,expires_at) VALUES(?,?,?,?,?,?,?)').run(id,'Cloudflare 远程链接收件',createHash('sha256').update(raw).digest('hex'),'write','api',new Date().toISOString(),null);
  try{await write(configPath,config);}catch(error){db.prepare('DELETE FROM tokens WHERE id=?').run(id);throw error;}
 }finally{db.close();}
 await write(workerPath,{name:'znote-capture-inbox',account_id:account,main:join(root,'addons/connectors/cloudflare/worker.js'),compatibility_date:'2026-10-21',workers_dev:true,observability:{enabled:false},d1_databases:[{binding:'DB',database_name:'znote-capture-inbox',database_id:database}]});
 console.log('Collector configured locally. Credentials stay in data/cloudflare-collector/config.json.');
}else if(command==='secret'||command==='secret-pages'){
 const config=JSON.parse(await readFile(configPath,'utf8'));
 const argumentsList=command==='secret'?['secret','put','CONNECTOR_SECRET','--config',workerPath]:['pages','secret','put','CONNECTOR_SECRET','--project-name','znote-capture-inbox','--config',join(dir,'pages.json')];
 const output=execFileSync(process.execPath,['--max-old-space-size=256',join(root,'addons/connectors/cloudflare/node_modules/wrangler/bin/wrangler.js'),...argumentsList],{input:config.connector_secret+'\n',encoding:'utf8',windowsHide:true,env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
 console.log(output);
}else if(command==='set-url'){
 const url=new URL(args[0]);if(url.protocol!=='https:'||!/^[-a-z0-9]+\.[-a-z0-9]+\.workers\.dev$|^[-a-z0-9]+\.pages\.dev$/.test(url.hostname)||url.pathname!=='/'||url.search||url.hash||url.username||url.password)throw Error('Expected a root HTTPS workers.dev or pages.dev URL');
 const config=JSON.parse(await readFile(configPath,'utf8')),client=jsonClient(url.origin,config.connector_secret,{remote:true});
 const health=await client('/api/health');if(health.mode!=='remote-capture')throw Error('This is not a ZNote remote inbox');
 config.relay_origin=url.origin;await write(configPath,config);console.log('Verified remote inbox: '+url.origin);
}else if(command==='pair'){
 const config=JSON.parse(await readFile(configPath,'utf8')),client=jsonClient(config.relay_origin,config.connector_secret,{remote:true});
 const code=randomBytes(12).toString('base64url'),result=await client('/connector/pair','POST',{code});
 await write(join(dir,'pairing.json'),{url:config.relay_origin,code,...result});console.log('A 24-hour one-use pairing code was saved to data/cloudflare-collector/pairing.json.');
}else throw Error('Use init, secret, secret-pages, set-url or pair');
