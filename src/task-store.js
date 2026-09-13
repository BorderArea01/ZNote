const active=new Set(['queued','running']);
const id=()=>globalThis.crypto?.randomUUID?.()||Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join('');
const cancelled=()=>Object.assign(new Error('已停止请求；已入库内容不会回退'),{name:'AbortError'});

export class TaskStore {
  constructor({limit=1000,history=100}={}) {
    this.limit=limit;this.history=history;this.jobs=new Map();this.listeners=new Set();this.lanes=new Set();this.closed=false;this.changes=0;
    this.remote={imports:[],exports:[],backup:null,error:null,loaded:false};this.watchers=0;this.refreshRemote=()=>{};
    this.snapshot={jobs:[],changes:0,remote:this.remote};
  }
  subscribe=fn=>{this.listeners.add(fn);return()=>this.listeners.delete(fn)};
  getSnapshot=()=>this.snapshot;
  emit(){this.snapshot={jobs:[...this.jobs.values()].map(({runner,resolve,promise,controller,result,...row})=>row).reverse(),changes:this.changes,remote:this.remote};for(const fn of this.listeners)fn();}
  setRemote(value){const previous=new Map(this.remote.imports.map(j=>[j.id,j.status]));if(this.remote.loaded&&value.imports.some(j=>j.status==='completed'&&previous.get(j.id)!=='completed'))this.changes++;this.remote={...value,loaded:true};this.emit();}
  result(id){return this.jobs.get(id)?.result;}
  forget(id){const job=this.jobs.get(id);if(job&&!active.has(job.status)){job.runner=null;this.jobs.delete(id);this.emit();}}
  prune(){const finished=[...this.jobs.values()].filter(j=>j.status==='completed');for(const job of finished.slice(0,Math.max(0,finished.length-this.history)))this.jobs.delete(job.id);}
  enqueue(entries){
    if(this.closed)throw Error('任务队列已关闭');
    const retained=[...this.jobs.values()].filter(j=>j.status!=='completed').length;
    if(entries.length+retained>this.limit)throw Error('待处理任务超过 '+this.limit+' 个，请先完成或清除部分任务');
    const output=entries.map(({run,...meta})=>{
      let resolve;const promise=new Promise(r=>resolve=r);
      const job={...meta,id:id(),status:'queued',message:'等待处理',progress:0,created_at:new Date().toISOString(),runner:run,resolve,promise,controller:new AbortController()};
      this.jobs.set(job.id,job);return {id:job.id,promise};
    });this.prune();this.emit();queueMicrotask(()=>this.pump());return output;
  }
  async execute(job){
    const lane=job.lane||job.type;this.lanes.add(lane);job.status='running';job.message=job.start_message||'正在处理';this.emit();
    try {
      const result=await job.runner({signal:job.controller.signal,update:patch=>{if(job.status==='running'&&!job.controller.signal.aborted){Object.assign(job,patch);this.emit();}}});
      // A response that confirmed saving wins over a simultaneous cancel click.
      job.status='completed';job.progress=100;job.message=job.done_message||'已完成';job.item_id=result?.id&&job.type==='upload'?result.id:undefined;job.file_id=job.type==='backup'?result?.id:undefined;
      if(job.type==='upload')this.changes++;
      job.result=result;job.duplicate=!!result?.duplicate;job.resolve({ok:true,value:result});job.runner=null;
    }catch(error){job.status=error.name==='AbortError'?'cancelled':'failed';job.message=error.name==='AbortError'?(job.type==='upload'?'已停止上传请求；已入库内容不会回退':'已停止请求'):job.type==='backup'&&error.name==='TypeError'?'未确认备份结果，请检查服务器备份记录后重试':error.message||'任务失败';job.resolve({ok:false,error});}
    finally{job.finished_at=new Date().toISOString();job.controller=null;job.resolve=null;job.promise=null;this.lanes.delete(lane);this.prune();this.emit();this.pump();}
  }
  pump(){if(this.closed)return;for(const job of this.jobs.values())if(job.status==='queued'&&!this.lanes.has(job.lane||job.type))void this.execute(job);}
  cancel(taskId){
    const job=this.jobs.get(taskId);if(!job||!active.has(job.status)||job.status==='running'&&(job.cancellable===false||job.phase==='processing'))return false;
    if(job.status==='queued'){job.status='cancelled';job.message='已取消，尚未开始';job.finished_at=new Date().toISOString();job.resolve({ok:false,error:cancelled()});job.resolve=null;job.promise=null;job.controller=null;this.emit();}
    else {job.message='正在停止请求…';job.controller.abort();this.emit();}return true;
  }
  retry(taskId){const job=this.jobs.get(taskId);if(!job||!['failed','cancelled'].includes(job.status)||!job.runner)throw Error('这条任务无法重试');job.status='queued';job.message='等待重试';job.progress=0;job.phase=null;job.controller=new AbortController();job.promise=new Promise(r=>job.resolve=r);job.finished_at=null;this.emit();queueMicrotask(()=>this.pump());return job.promise;}
  clear({failed=false,scope='all'}={}){for(const job of this.jobs.values())if((scope==='all'||job.global||(job.collection_id||'unfiled')===scope)&&(job.status==='completed'||job.status==='cancelled'||(failed&&job.status==='failed'))){job.runner=null;this.jobs.delete(job.id);}this.emit();}
  dispose(){this.closed=true;for(const job of this.jobs.values()){if(job.status==='queued'){job.resolve?.({ok:false,error:cancelled()});job.runner=null;}else if(job.status==='running')job.controller.abort();}this.listeners.clear();this.jobs.clear();this.snapshot={jobs:[],changes:this.changes};}
}
