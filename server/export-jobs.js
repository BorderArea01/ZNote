import {randomUUID} from 'node:crypto';
import {finished} from 'node:stream/promises';
import {validateExportQuery} from './exports.js';
import {WorkQueue} from './work-queue.js';

const fail = (status,message) => Object.assign(Error(message),{status});
const live = status => ['ready','queued','running'].includes(status);
const names = {portable:'资料包 ZIP',images:'图片包 ZIP',markdown:'Markdown ZIP',json:'JSON 元数据',html:'离线网页 ZIP',backup:'迁移备份 ZIP'};
// Receipts contain parameters and stream status, never file contents or tokens.
// Downloads are native HTTP streams; no additional archive is stored on disk.
export function registerExportJobs({app,db,admin,streamExport,clock=Date.now}) {
  const jobs=new Map(), queue=new WorkQueue(1,20);
  const publicJob=({response,query,...job})=>({...job,download_url:'/api/export-jobs/'+job.id+'/file'});
  const end=(job,status,message)=>{job.status=status;job.message=message;job.finished_at=new Date(clock()).toISOString();};
  const sweep=()=>{
    for(const job of jobs.values()) {
      if(job.status==='ready'&&clock()-Date.parse(job.created_at)>5*60000)end(job,'failed','浏览器未开始下载，请重试；必要时允许此站点下载文件');
      if(!live(job.status)&&clock()-Date.parse(job.finished_at)>86400000)jobs.delete(job.id);
    }
    const ended=[...jobs.values()].filter(j=>!live(j.status));
    for(const job of ended.slice(0,Math.max(0,ended.length-50)))jobs.delete(job.id);
  };
  const get=id=>{sweep();const job=jobs.get(id);if(!job)throw fail(404,'导出记录已过期或服务器已重启，请重新导出');return job;};
  const add=input=>{
    sweep();const query=validateExportQuery(db,input);
    if([...jobs.values()].filter(j=>live(j.status)).length>=20)throw fail(429,'导出队列已满，请完成或取消部分任务后重试');
    const job={id:randomUUID(),query,type:'export',title:names[query.mode],mode:query.mode,collection_id:query.collection==='unfiled'?null:query.collection||null,global:!query.collection,status:'ready',message:'等待浏览器接收下载',created_at:new Date(clock()).toISOString(),bytes:0,entries:0};
    jobs.set(job.id,job);return job;
  };
  app.get('/api/export-jobs',admin,(req,res)=>{sweep();res.json({jobs:[...jobs.values()].reverse().map(publicJob)});});
  app.post('/api/export-jobs',admin,(req,res)=>res.status(201).json(publicJob(add(req.body))));
  app.post('/api/export-jobs/:id/retry',admin,(req,res)=>{
    const old=get(req.params.id);
    if(old.retried_as&&jobs.has(old.retried_as))return res.status(200).json(publicJob(jobs.get(old.retried_as)));
    if(!['failed','cancelled','completed'].includes(old.status))throw fail(409,'任务仍在进行，请先取消或等待完成');
    const job=add(old.query);old.retried_as=job.id;res.status(201).json(publicJob(job));
  });
  app.delete('/api/export-jobs/:id',admin,(req,res)=>{
    const job=get(req.params.id);
    if(live(job.status)){end(job,'cancelled','已取消导出；浏览器中的未完成下载可移除');job.response?.destroy();}
    res.json(publicJob(job));
  });
  // A HEAD probe must never consume a one-use download receipt.
  app.head('/api/export-jobs/:id/file',admin,(req,res)=>{get(req.params.id);res.status(204).end();});
  app.get('/api/export-jobs/:id/file',admin,async(req,res)=>{
    const job=get(req.params.id);
    if(job.status!=='ready')throw fail(409,'这次导出已开始或结束，请从任务中心重新下载');
    job.status='queued';job.message='等待导出';job.response=res;
    res.set('Cache-Control','no-store');
    const closed=()=>{if(!res.writableFinished&&live(job.status))end(job,'failed','下载连接已中断，请重试');};
    res.once('close',closed);
    try {
      await queue.run(job.id,async()=>{
        if(!live(job.status)||res.destroyed)return;
        job.status='running';job.message='正在打包并传送到浏览器';
        const completed=finished(res);completed.catch(()=>{});
        try {
          await streamExport({query:job.query},res,progress=>{job.bytes=progress.bytes;job.entries=progress.entries;});
          await completed;
          if(job.mode==='json'){job.bytes=Number(res.getHeader('Content-Length'))||job.bytes;job.entries=1;}
          if(live(job.status))end(job,'completed','服务器已传送完成；保存结果请查看浏览器下载列表');
        }catch(error){res.destroy();await completed.catch(()=>{});throw error;}
      });
    }catch(error){
      if(job.status!=='cancelled')end(job,'failed',error.status&&error.status<500?error.message:'导出失败，请检查原文件、磁盘与连接后重试');
      if(!res.headersSent&&!res.destroyed)res.status(error.status||500).json({error:job.message});
      else res.destroy();
    }finally{job.response=null;res.off('close',closed);sweep();}
  });
  return {clear(){for(const j of jobs.values())j.response?.destroy();jobs.clear();},diagnostics:()=>({active:queue.active,pending:queue.pending.length,retained:jobs.size})};
}
