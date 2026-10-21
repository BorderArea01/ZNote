import assert from 'node:assert/strict';import{DatabaseSync}from'node:sqlite';import{readFile}from'node:fs/promises';import worker from '../../addons/connectors/cloudflare/worker.js';
export async function inboxFixture(){
 const sql=new DatabaseSync(':memory:');sql.exec(await readFile('addons/connectors/cloudflare/schema.sql','utf8'));
 const statement=(text,args=[])=>({bind:(...args)=>statement(text,args),first:async()=>sql.prepare(text).get(...args)||null,all:async()=>({results:sql.prepare(text).all(...args)}),run:async()=>({meta:{changes:Number(sql.prepare(text).run(...args).changes)}})});
 const DB={prepare:statement,batch:async statements=>{sql.exec('BEGIN');try{const rows=[];for(const s of statements)rows.push(await s.run());sql.exec('COMMIT');return rows;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 const env={DB,CONNECTOR_SECRET:'connector-secret-'+('x'.repeat(40))};
 const call=async(path,method='GET',input,headers={})=>worker.fetch(new Request('https://inbox.example'+path,{method,headers:{'Content-Type':'application/json',...headers},...(input===undefined?{}:{body:JSON.stringify(input)})}),env);
 const connector=(path,input)=>call('/connector/'+path,'POST',input,{Authorization:'Bearer '+env.CONNECTOR_SECRET});
 const pair=async()=>{const code=crypto.randomUUID();assert.equal((await connector('pair',{code})).status,200);const response=await call('/api/auth/login','POST',{password:code});assert.equal(response.status,200);return response.headers.get('Set-Cookie').split(';')[0];};
 return {sql,env,call,connector,pair};
}
