import React,{createContext,useContext,useEffect,useState,useSyncExternalStore} from 'react';
import {ListTodo,RefreshCw,Loader2,CheckCircle2,AlertCircle} from 'lucide-react';
import {TaskStore} from './task-store.js';
import {api,send,bytes,uploadFile} from './api.js';
import {Dialog} from './ui.jsx';
import {HelpHint} from './HelpHint.jsx';
import './tasks.css';
const Context=createContext(null),live=s=>['queued','running','saving'].includes(s);
export const useTaskStore=()=>useContext(Context);
export const useTaskSnapshot=()=>{const store=useTaskStore();return useSyncExternalStore(store.subscribe,store.getSnapshot)};
export function TaskProvider({children}){
  const [store]=useState(()=>new TaskStore());
  useEffect(()=>{
    let disposed=false,timer,controller,inflight=false;
    const poll=async()=>{
      clearTimeout(timer);if(disposed||document.hidden||inflight)return;inflight=true;controller=new AbortController();
      const results=await Promise.allSettled([api('/api/imports',{signal:controller.signal}),api('/api/backups',{signal:controller.signal})]);
      if(!disposed)store.setRemote({imports:results[0].status==='fulfilled'?results[0].value.jobs:store.remote.imports,backup:results[1].status==='fulfilled'?results[1].value:store.remote.backup,error:results.some(r=>r.status==='rejected')?'部分服务器状态未能更新，可刷新重试；下方保留上次结果':null});
      inflight=false;if(!disposed)timer=setTimeout(poll,store.remote.error?15000:store.watchers||store.remote.backup?.busy||store.remote.imports.some(j=>live(j.status))?2500:30000);
    };
    store.refreshRemote=poll;const wake=()=>{if(!document.hidden)void poll();else clearTimeout(timer)};
    const warn=e=>{if(store.getSnapshot().jobs.some(j=>j.status==='queued'||j.status==='running'&&j.type!=='backup')){e.preventDefault();e.returnValue='';}};
    window.addEventListener('beforeunload',warn);document.addEventListener('visibilitychange',wake);window.addEventListener('focus',wake);void poll();
    return()=>{disposed=true;clearTimeout(timer);controller?.abort();window.removeEventListener('beforeunload',warn);document.removeEventListener('visibilitychange',wake);window.removeEventListener('focus',wake);store.dispose();};
  },[store]);
  return <Context.Provider value={store}>{children}</Context.Provider>;
}
export function queueUploads(store,files,collection,tags=[]){
  const target=collection&&collection!=='unfiled'?collection:null,labelTags=[...tags];
  return store.enqueue(files.map(file=>({type:'upload',lane:'upload',title:file.name,collection_id:target,size:file.size,cancellable:true,start_message:'正在上传',done_message:'已入库',run:async({signal,update})=>uploadFile(file,target,labelTags,progress=>update({progress,phase:progress===100?'processing':'sending',message:progress===100?'正在验证文件并入库':`上传 ${progress}%`}),signal)})));
}
export function TaskButton({onClick}){const {jobs,remote}=useTaskSnapshot();const count=jobs.filter(j=>live(j.status)).length+remote.imports.filter(j=>live(j.status)).length+(remote.backup?.busy&&!jobs.some(j=>j.type==='backup'&&live(j.status))?1:0),failed=jobs.some(j=>j.status==='failed')||remote.imports.some(j=>j.status==='failed'&&!j.retried_as)||remote.error;return <button className="task-button" aria-label="任务中心" onClick={onClick}><ListTodo size={18}/><span className="task-button-label">任务</span>{count>0?<b>{count}</b>:failed?<span className="task-dot"/>:null}</button>}
export function TaskCenter({collection,collections,onClose,onOpen,onImports,onBackup}){
  const store=useTaskStore(),{jobs,remote}=useTaskSnapshot();
  const [scope,setScope]=useState(collection||'unfiled'),[filter,setFilter]=useState('all'),[page,setPage]=useState(0),[error,setError]=useState(''),[busy,setBusy]=useState('');
  useEffect(()=>{store.watchers++;store.refreshRemote();return()=>{store.watchers--}},[store]);
  const libraryName=id=>id?collections.find(c=>c.id===id)?.name||'已删除的知识库':'未分类';
  const local=jobs.map(job=>({...job,origin:'local'})),imports=remote.imports.map(job=>({...job,id:'import:'+job.id,remote_id:job.id,status:job.retried_as?'resubmitted':job.status,title:job.title||job.source_url,type:'import',origin:'server'}));
  const backups=(remote.backup?.backups||[]).filter(b=>!jobs.some(j=>j.file_id===b.id)).map(b=>({...b,id:'backup:'+b.id,file_id:b.id,type:'backup',status:'completed',title:'完整备份',message:bytes(b.bytes),origin:'server',global:true}));
  const all=[...local,...imports,...backups].filter(j=>(scope==='all'||j.global||(j.collection_id||'unfiled')===scope)&&(filter==='all'||filter==='active'&&live(j.status)||filter==='failed'&&j.status==='failed')).sort((a,b)=>Number(live(b.status))-Number(live(a.status))||new Date(b.created_at)-new Date(a.created_at));
  const visible=all.slice(page*40,page*40+40);
  const act=async(id,fn)=>{setBusy(id);setError('');try{await fn();store.refreshRemote();}catch(e){setError(e.message);}finally{setBusy('');}};
  return <Dialog title="任务中心" className="task-dialog" onClose={onClose}><div className="task-toolbar"><select aria-label="任务知识库" value={scope} onChange={e=>{setScope(e.target.value);setPage(0)}}><option value="all">全部知识库</option><option value="unfiled">未分类</option>{collections.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select><select aria-label="任务状态" value={filter} onChange={e=>{setFilter(e.target.value);setPage(0)}}><option value="all">全部状态</option><option value="active">进行中</option><option value="failed">需要处理</option></select><button aria-label="刷新任务" onClick={()=>store.refreshRemote()}><RefreshCw size={16}/></button><HelpHint label="任务保存范围">上传与导出在本页面执行，关闭弹窗可继续；刷新或关闭整个网页会中断，原文件需重新选择。采集和备份由服务器执行。服务器采集记录重启后清空，已入库文件保留。备份作用于全部知识库。</HelpHint></div>
    {(error||remote.error)&&<p className="error task-error" role="alert">{error||remote.error}</p>}
    {remote.backup?.busy&&!jobs.some(j=>j.type==='backup'&&live(j.status))&&<p className="task-server-status" role="status"><Loader2 size={16} className="spin"/>服务器正在备份或校验恢复，完成后可查看结果。</p>}
    {remote.backup?.last_error&&<p className="error task-error">最近备份：{remote.backup.last_error}</p>}
    <div className="task-list">{!visible.length&&<div className="task-empty"><ListTodo size={32}/><p>当前范围没有任务</p></div>}{visible.map(job=><article key={job.id} className="task-row" data-task-id={job.id}><div className="task-state-icon">{live(job.status)?<Loader2 size={19} className="spin"/>:job.status==='failed'?<AlertCircle size={19}/>:<CheckCircle2 size={19}/>}</div><div className="task-info"><strong title={job.title}>{job.title}</strong><small>{({upload:'上传',export:'导出',backup:'备份',import:'网络采集'})[job.type]} · {job.global?'全部知识库':libraryName(job.collection_id)} · {job.type!=='backup'&&job.origin==='local'?'当前页面':'服务器'}</small><p>{job.message||job.status}</p>{live(job.status)&&job.type==='upload'&&<progress max="100" value={job.progress}/>}</div><div className="task-actions">
      {job.origin==='local'&&live(job.status)&&(job.status==='queued'||job.cancellable!==false&&job.phase!=='processing')&&<button onClick={()=>store.cancel(job.id)}>取消</button>}
      {job.origin==='local'&&['failed','cancelled'].includes(job.status)&&<button onClick={()=>{try{store.retry(job.id)}catch(e){setError(e.message)}}}>重试</button>}
      {job.type==='import'&&['queued','running'].includes(job.status)&&<button disabled={!!busy} onClick={()=>act(job.id,()=>send('/api/imports/'+job.remote_id,{},'DELETE'))}>取消</button>}
      {job.type==='import'&&['failed','cancelled'].includes(job.status)&&<button disabled={!!busy} onClick={()=>act(job.id,()=>send('/api/imports/'+job.remote_id+'/retry',{}))}>重试</button>}
      {job.item_id&&job.status==='completed'&&<button onClick={()=>onOpen(job.item_id)}>打开内容</button>}
      {job.file_id&&job.status==='completed'&&<a className="button" href={'/api/backups/'+job.file_id+'/download'}>下载备份</a>}
    </div></article>)}</div>
    <div className="task-footer"><button onClick={()=>{store.clear({failed:true,scope});setPage(0)}}>清除本地已结束记录</button><span>{all.length} 条</span>{all.length>40&&<><button disabled={!page} onClick={()=>setPage(n=>n-1)}>上一页</button><button disabled={(page+1)*40>=all.length} onClick={()=>setPage(n=>n+1)}>下一页</button></>}<button onClick={onImports}>网络采集</button><button onClick={onBackup}>备份设置</button></div>
  </Dialog>;
}
