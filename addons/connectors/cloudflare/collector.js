import {request as httpRequest} from 'node:http';
import {request as httpsRequest} from 'node:https';
import {proxyAgent} from '../../../server/network-proxy.js';

// Fixed origins only: a cloud job can supply a share link, never a local API
// path, destination address, credential, file path or executable command.
export function jsonClient(origin,credential,{remote=false}={}){
 const base=new URL(origin);
 if(base.username||base.password||base.search||base.hash||base.pathname!=='/')throw Error('服务器地址必须是根地址');
 if(remote?base.protocol!=='https:':base.protocol!=='http:'||!['localhost','127.0.0.1','[::1]'].includes(base.hostname))throw Error('连接器仅支持 HTTPS 收件箱与本机 ZNote');
 return (path,method='GET',input)=>new Promise((resolve,reject)=>{
  if(!/^\/(?:api|connector)\/[a-zA-Z0-9/_-]+$/.test(path))return reject(Error('无效的接口路径'));
  const data=input===undefined?undefined:Buffer.from(JSON.stringify(input));let settled=false,response;
  const done=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(result);};
  const request=(base.protocol==='https:'?httpsRequest:httpRequest)(new URL(path,base),{method,headers:{Authorization:'Bearer '+credential,...(data?{'Content-Type':'application/json','Content-Length':data.length}:{})},...(remote?{agent:proxyAgent()}:{})},res=>{
   response=res;const chunks=[];let bytes=0;
   res.on('data',chunk=>{bytes+=chunk.length;if(bytes>2*1024*1024){res.destroy();done(Error('接口响应过大'));}else chunks.push(chunk);});
   res.on('error',error=>done(error));res.on('aborted',()=>done(Error('接口响应中断')));
   res.on('end',()=>{if(res.statusCode===204&&bytes===0)return done(null,null);let result;try{result=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return done(Error('接口没有返回有效数据'));}
    if(res.statusCode<200||res.statusCode>=300)return done(Object.assign(Error(result.error||'接口请求失败'),{status:res.statusCode}));done(null,result);
   });
  });
  const timer=setTimeout(()=>{response?.destroy();request.destroy();done(Error('接口连接超时'));},20000);
  request.on('error',error=>done(error));request.end(data);
 });
}

export function createCollector({local,relay,state={jobs:[]},save=async()=>{}}){
 const jobs=new Map((state.jobs||[]).map(j=>[j.id,j]));
 const persist=()=>save({jobs:[...jobs.values()]});
 async function observe(entry){
  try{
   if(!entry.local_id){
    const result=await local('/api/captures','POST',{...entry.input,request_id:'cf:'+entry.id});
    entry.local_id=result.id;entry.needs_retry=false;await persist();
   }
   let job=await local('/api/captures/'+encodeURIComponent(entry.local_id));
   if(entry.needs_retry&&job.status==='failed')job=await local('/api/captures/'+encodeURIComponent(entry.local_id)+'/retry','POST',{});
   entry.needs_retry=false;
   if(!['queued','running','failed','completed'].includes(job.status))throw Error('开发机任务状态无效');
   entry.status=job.status;entry.message=String(job.message||'等待开发机处理').slice(0,1800);entry.title=String(job.title||'作品采集').slice(0,200);
  }catch(error){
   if(error.status&&![401,403,429,500,502,503,504].includes(error.status)){
    entry.status='failed';entry.message=error.status===404?'开发机中的采集记录已移除，请重新提交分享链接':String(error.message).slice(0,1800);
   }else{entry.status=entry.local_id?'running':'queued';entry.message=error.status===401||error.status===403?'开发机采集授权已失效，请在开发机修复连接器':'开发机暂时无法处理，任务已保留等待恢复';}
  }
 }
 return {
  async step(){
   const collections=await local('/api/collections');if(!Array.isArray(collections))throw Error('开发机知识库目录无效');
   for(const entry of jobs.values())await observe(entry);
   await persist();
   const updates=[...jobs.values()].map(({id,lease,status,message,local_id,title})=>({id,lease,status,message,...(local_id?{local_id}:{}),...(title?{title}:{})}));
   const result=await relay('/connector/sync','POST',{collections:collections.map(({id,name})=>({id,name})),updates,can_claim:jobs.size<8});
   for(const entry of [...jobs.values()])if(['completed','failed'].includes(entry.status))jobs.delete(entry.id);
   if(result.job){
    const job=result.job;
    if(!/^[a-f0-9-]{36}$/.test(job.id)||typeof job.lease!=='string'||!job.input||typeof job.input.text!=='string'||job.input.text.length>16000)throw Error('收件箱任务格式无效');
    const entry={id:job.id,lease:job.lease,input:{text:job.input.text,collection_id:job.input.collection_id||null,image_mode:job.input.image_mode||'group',tags:job.input.tags||[]},...(job.local_id?{local_id:job.local_id}:{}),needs_retry:job.attempt>0,status:'queued',message:'等待开发机采集'};
    jobs.set(entry.id,entry);await persist();await observe(entry);
   }
   await persist();return {active:jobs.size};
  },
  snapshot:()=>({jobs:[...jobs.values()].map(j=>({...j}))}),
 };
}
