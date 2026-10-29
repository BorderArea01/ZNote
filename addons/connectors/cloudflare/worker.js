import {portalHtml,portalScript,portalCss} from './portal.js';
import {connectHtml,connectScript,connectCss} from './connect.js';
import {sharedUrls} from '../../../shared/share-input.js';
const json=(value,status=200,headers={})=>Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
const fail=(status,message)=>{throw Object.assign(Error(message),{status});};
const hash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),v=>v.toString(16).padStart(2,'0')).join('');
const secret=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),v=>v.toString(16).padStart(2,'0')).join('');
const PAIR_TTL=24*60*60*1000;
const publicJob=row=>({id:row.id,status:row.status,title:row.title,message:row.message,source_url:row.source_url,created_at:new Date(row.created).toISOString(),collection_id:JSON.parse(row.input).collection_id,attempt:row.attempt});
async function body(request){
 if(Number(request.headers.get('Content-Length'))>32768)fail(413,'分享文字过长');
 const reader=request.body?.getReader();if(!reader)return {};
 const chunks=[];let size=0;try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>32768){await reader.cancel();fail(413,'分享文字过长');}chunks.push(value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let at=0;for(const c of chunks){bytes.set(c,at);at+=c.length;}
 try{return JSON.parse(new TextDecoder().decode(bytes));}catch{fail(400,'请求格式不正确');}
}
function captureInput(raw){
 if(typeof raw.text!=='string'||!raw.text.trim()||raw.text.length>16000)fail(400,'请提供作品分享文字或链接');
 const found=sharedUrls(raw.text);
 if(found.length!==1)fail(400,'每次分享请包含一个完整作品链接');
 let url;try{url=new URL(found[0].replace(/[,;!]+$/,''));}catch{fail(400,'分享链接格式不正确');}
 if(url.username||url.password||url.href.length>8192)fail(400,'分享链接格式不正确');
 if(raw.collection_id!==undefined&&raw.collection_id!==null&&(typeof raw.collection_id!=='string'||raw.collection_id.length>100))fail(400,'知识库编号无效');
 if(raw.image_mode!==undefined&&!['group','note'].includes(raw.image_mode))fail(400,'保存方式无效');
 const tags=raw.tags||[];if(!Array.isArray(tags)||tags.length>20||tags.some(v=>typeof v!=='string'||!v.trim()||v.length>40))fail(400,'标签格式不正确');
 const requestId=raw.request_id||crypto.randomUUID();if(!/^[a-zA-Z0-9:_-]{1,160}$/.test(requestId))fail(400,'分享编号无效');
 return {source:url.href,requestId,input:{text:raw.text.trim(),collection_id:raw.collection_id||null,image_mode:raw.image_mode||'group',tags}};
}
async function token(db,name,kind,now){const raw='zn_'+secret(),id=crypto.randomUUID(),expires=now+(kind==='session'?30:180)*86400000;await db.prepare('INSERT INTO relay_tokens(id,hash,kind,name,expires) VALUES(?,?,?,?,?)').bind(id,await hash(raw),kind,name,expires).run();return {id,token:raw,scope:'write',name,expires_at:new Date(expires).toISOString()};}
async function auth(request,db,now){
 const bearer=request.headers.get('Authorization')?.match(/^Bearer (.+)$/)?.[1];
 const cookie=request.headers.get('Cookie')?.split(';').map(v=>v.trim()).find(v=>v.startsWith('znote_session='))?.slice(14);
 const value=bearer||cookie;if(!value)fail(401,'请先使用连接码授权这台手机');
 const row=await db.prepare('SELECT * FROM relay_tokens WHERE hash=? AND expires>?').bind(await hash(value),now).first();if(!row)fail(401,'远程采集授权已失效，请重新连接');return row;
}
async function connectorAuth(request,env){
 if(typeof env.CONNECTOR_SECRET!=='string'||env.CONNECTOR_SECRET.length<32)fail(503,'远程收件箱尚未完成配置');
 const value=request.headers.get('Authorization')?.match(/^Bearer (.+)$/)?.[1]||'';
 const a=await hash(value),b=await hash(env.CONNECTOR_SECRET);let mismatch=0;for(let i=0;i<a.length;i++)mismatch|=a.charCodeAt(i)^b.charCodeAt(i);if(mismatch)fail(401,'连接器授权无效');
}
async function route(request,env){
 const db=env.DB,url=new URL(request.url),path=url.pathname,now=Date.now();
 const origin=request.headers.get('Origin');
 if(!['GET','HEAD','OPTIONS'].includes(request.method)&&origin&&origin!==url.origin&&origin!=='chrome-extension://ndfidbdoncgiaamafhgfpbdnbeiedile')fail(403,'不允许跨站提交');
 if(!['GET','HEAD','OPTIONS'].includes(request.method)&&origin==='chrome-extension://ndfidbdoncgiaamafhgfpbdnbeiedile'&&!/^Bearer zn_[a-f0-9]{64}$/.test(request.headers.get('Authorization')||''))fail(403,'扩展请求需要独立设备授权');
 if(request.method==='GET'&&(path==='/'||path==='/connect'||/^\/connect\/[a-zA-Z0-9_-]{16,80}\/?$/.test(path)))return new Response(path==='/'?portalHtml:connectHtml,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",'X-Frame-Options':'DENY','Referrer-Policy':'no-referrer'}});
 if(request.method==='GET'&&path==='/connect.js')return new Response(connectScript,{headers:{'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-store'}});
 if(request.method==='GET'&&path==='/portal.js')return new Response(portalScript,{headers:{'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-store'}});
 if(request.method==='GET'&&path==='/portal.css')return new Response(portalCss+connectCss,{headers:{'Content-Type':'text/css; charset=utf-8','Cache-Control':'no-store'}});
 if(request.method==='GET'&&path==='/api/health')return json({status:'ok',version:'0.1.0',mode:'remote-capture'});
 if(request.method==='GET'&&path==='/api/auth/status')return json({configured:true});
 if(path.startsWith('/connector/')){
  await connectorAuth(request,env);const input=await body(request);
  if(request.method==='POST'&&path==='/connector/pair'){
   if(typeof input.code!=='string'||!/^[a-zA-Z0-9_-]{16,80}$/.test(input.code))fail(400,'连接码格式无效');
   await db.batch([db.prepare('DELETE FROM relay_pairs WHERE expires<?').bind(now),db.prepare('DELETE FROM relay_tokens WHERE expires<?').bind(now),db.prepare('INSERT INTO relay_pairs(hash,expires) VALUES(?,?)').bind(await hash(input.code),now+PAIR_TTL)]);return json({expires_at:new Date(now+PAIR_TTL).toISOString()});
  }
  if(request.method==='POST'&&path==='/connector/sync'){
   if(!Array.isArray(input.collections)||input.collections.length>1000||input.collections.some(c=>typeof c.id!=='string'||c.id.length>100||typeof c.name!=='string'||c.name.length>200))fail(400,'知识库目录格式无效');
   if(!Array.isArray(input.updates)||input.updates.length>16)fail(400,'任务更新格式无效');
   const statements=[];
   for(const update of input.updates){if(typeof update.id!=='string'||typeof update.lease!=='string'||!['queued','running','failed','completed'].includes(update.status)||typeof update.message!=='string'||update.message.length>2000||update.local_id!==undefined&&typeof update.local_id!=='string')fail(400,'任务状态格式无效');
    statements.push(db.prepare('UPDATE relay_jobs SET status=?,message=?,title=COALESCE(?,title),local_id=COALESCE(?,local_id),lease_until=?,updated=? WHERE id=? AND lease=? AND status IN (\'queued\',\'running\')').bind(update.status,update.message,update.title?.slice(0,200)||null,update.local_id||null,now+120000,now,update.id,update.lease));
   }
   const collections=JSON.stringify(input.collections.map(({id,name})=>({id,name})));
   statements.push(db.prepare("INSERT INTO relay_meta(key,value) VALUES('collections',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE value<>excluded.value").bind(collections));
   statements.push(db.prepare("INSERT INTO relay_meta(key,value) VALUES('seen',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE value<>excluded.value").bind(String(Math.floor(now/60000)*60000)));
   // Sweep once per hour across isolates, rather than scan cloud history on
   // every idle heartbeat. Pending/failed tasks are never evicted here.
   const sweepIndex=statements.length;
   statements.push(db.prepare("INSERT INTO relay_meta(key,value) VALUES('sweep',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE value<>excluded.value").bind(String(Math.floor(now/3600000))));
   const writes=await db.batch(statements);
   if(writes[sweepIndex].meta.changes)await db.batch([db.prepare("DELETE FROM relay_jobs WHERE status='completed' AND updated<?").bind(now-7*86400000),db.prepare('DELETE FROM relay_tokens WHERE expires<?').bind(now),db.prepare('DELETE FROM relay_attempts WHERE expires<?').bind(now)]);
   let job=null;if(input.can_claim===true){job=await db.prepare("UPDATE relay_jobs SET lease=?,lease_until=? WHERE id=(SELECT id FROM relay_jobs WHERE status IN ('queued','running') AND lease_until<? ORDER BY created LIMIT 1) RETURNING *").bind(secret(),now+120000,now).first();}
   return json({job:job?{...publicJob(job),input:JSON.parse(job.input),lease:job.lease,local_id:job.local_id}:null});
  }
  fail(404,'连接器接口不存在');
 }
 if(request.method==='POST'&&path==='/api/auth/login'){
  const input=await body(request),ip=await hash((request.headers.get('CF-Connecting-IP')||'unknown')+env.CONNECTOR_SECRET);
  const attempt=await db.prepare('INSERT INTO relay_attempts(ip,count,expires) VALUES(?,1,?) ON CONFLICT(ip) DO UPDATE SET count=CASE WHEN expires<? THEN 1 ELSE count+1 END,expires=CASE WHEN expires<? THEN excluded.expires ELSE expires END RETURNING count').bind(ip,now+60000,now,now).first();if(attempt.count>10)fail(429,'尝试次数过多，请一分钟后重试');
  await db.prepare('DELETE FROM relay_attempts WHERE expires<?').bind(now).run();
  if(typeof input.password!=='string'||input.password.length>100)fail(401,'连接码无效或已过期');
  const pair=await db.prepare('DELETE FROM relay_pairs WHERE hash=? AND expires>? RETURNING hash').bind(await hash(input.password.trim()),now).first();if(!pair)fail(401,'连接码无效或已使用，请在开发机重新生成');
  const session=await token(db,'手机连接','session',now);return json({ok:true},200,{'Set-Cookie':`znote_session=${session.token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=2592000`});
 }
 const user=await auth(request,db,now);
 if(request.method==='POST'&&path==='/api/tokens'){
  if(user.kind!=='session')fail(403,'请先登录连接页面');const input=await body(request);if(input.scope!=='write'||typeof input.name!=='string'||input.name.length>100)fail(400,'设备授权格式无效');
  return json(await token(db,input.name,'api',now),201);
 }
 if(request.method==='POST'&&path==='/api/auth/logout'){await db.prepare('DELETE FROM relay_tokens WHERE id=?').bind(user.id).run();return json({ok:true},200,{'Set-Cookie':'znote_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0'});}
 if(request.method==='GET'&&path==='/api/collections'){const row=await db.prepare("SELECT value FROM relay_meta WHERE key='collections'").first();return json(JSON.parse(row?.value||'[]'));}
 if(request.method==='GET'&&path==='/api/relay/status'){const seen=await db.prepare("SELECT value FROM relay_meta WHERE key='seen'").first();return json({online:now-Number(seen?.value||0)<180000,last_seen:seen?.value?new Date(Number(seen.value)).toISOString():null});}
 // One inbox belongs to one ZNote library. All paired devices share its jobs,
 // just as they share the library's collections; this is not multi-tenancy.
 const owner='library';
 if(request.method==='GET'&&path==='/api/captures'){const rows=await db.prepare('SELECT * FROM relay_jobs WHERE owner=? ORDER BY created DESC LIMIT 50').bind(owner).all();return json({jobs:rows.results.map(publicJob)});}
 if(request.method==='POST'&&path==='/api/captures'){
  const {input,requestId,source}=captureInput(await body(request));
  const found=await db.prepare('SELECT * FROM relay_jobs WHERE owner=? AND request_id=?').bind(owner,requestId).first();
  if(found){if(found.input!==JSON.stringify(input))fail(409,'这次分享编号已用于其他内容');return json(publicJob(found),202);}
  const count=await db.prepare("SELECT count(*) n FROM relay_jobs WHERE status<>'completed'").first();if(count.n>=200)fail(429,'远程待处理任务已满，请先处理失败记录');
  const id=crypto.randomUUID();await db.prepare('INSERT INTO relay_jobs(id,owner,request_id,input,source_url,title,status,message,created,updated) VALUES(?,?,?,?,?,?,\'queued\',?,?,?) ON CONFLICT(owner,request_id) DO NOTHING').bind(id,owner,requestId,JSON.stringify(input),source,source,'链接已接收，等待开发机采集',now,now).run();const saved=await db.prepare('SELECT * FROM relay_jobs WHERE owner=? AND request_id=?').bind(owner,requestId).first();if(saved.input!==JSON.stringify(input))fail(409,'这次分享编号已用于其他内容');return json(publicJob(saved),202);
 }
 const match=path.match(/^\/api\/captures\/([a-f0-9-]{36})(\/retry)?$/);
 if(match){
  const job=await db.prepare('SELECT * FROM relay_jobs WHERE id=? AND owner=?').bind(match[1],owner).first();if(!job)fail(404,'采集任务不存在');
  if(request.method==='GET'&&!match[2])return json(publicJob(job));
  if(request.method==='POST'&&match[2]){if(job.status!=='failed')fail(409,'只有失败任务可以重试');const row=await db.prepare("UPDATE relay_jobs SET status='queued',message='等待开发机重试',attempt=attempt+1,lease=NULL,lease_until=0,updated=? WHERE id=? AND status='failed' RETURNING *").bind(now,job.id).first();if(!row)fail(409,'任务状态已变化');return json(publicJob(row),202);}
  if(request.method==='DELETE'&&!match[2]){if(!['failed','completed'].includes(job.status))fail(409,'请等待任务结束后移除记录');await db.prepare('DELETE FROM relay_jobs WHERE id=? AND owner=?').bind(job.id,owner).run();return json({removed:true});}
 }
 if(request.method==='POST'&&['/api/assets','/api/videos'].includes(path))fail(413,'远程采集入口只接收分享链接，不接收图片或视频文件');
 fail(404,'此入口用于远程采集链接，知识库原文件仍保存在开发机');
}
export default {async fetch(request,env){try{return await route(request,env);}catch(error){return json({error:error.status?error.message:'远程收件箱暂时不可用，请稍后重试'},error.status||503);}}};
