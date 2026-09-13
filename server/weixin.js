import {createHash,randomUUID} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {API_BASE,createWeixinClient,weixinUrl} from './weixin-client.js';
const KEY='weixin_inbox_v1';
const fault=message=>Object.assign(Error(message),{status:400});
export function weixinItemId(job,index='note'){
  const hex=createHash('sha256').update(job+':'+index).digest('hex');
  return hex.slice(0,8)+'-'+hex.slice(8,12)+'-4'+hex.slice(13,16)+'-a'+hex.slice(17,20)+'-'+hex.slice(20,32);
}
export function weixinMessageKey(message,account){
  const id=message.client_id||(typeof message.message_id==='string'||Number.isSafeInteger(message.message_id)?String(message.message_id):'');
  if(typeof id!=='string'||!id||id.length>256)throw fault('微信消息缺少可靠的编号，未自动入库');
  return createHash('sha256').update(JSON.stringify([account.bot,message.from_user_id,id])).digest('hex');
}
export function createWeixinInbox({db,saveImage,saveNote,exists,work,validateCollection,client=createWeixinClient()}){
  const defaults=()=>({enabled:false,collection_id:null,tags:['微信'],account:null,cursor:'',jobs:[]});
  const read=()=>{const row=db.prepare('SELECT value FROM settings WHERE key=?').get(KEY);return row?JSON.parse(row.value):defaults();};
  const write=state=>{const value=JSON.stringify(state);if(value.length>2*1024*1024)throw fault('微信收件箱已满，请先处理失败消息');db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(KEY,value);};
  const patch=fn=>{const state=read();fn(state);write(state);return state;};
  let loop,controller,qr,loginController,loginWork,status='未连接',lastError='',activeJob=null;
  function publicState(){const s=read();return {connected:!!s.account,enabled:s.enabled,collection_id:s.collection_id,tags:s.tags,status,lastError,active:activeJob,login:qr?{id:qr.id,status:qr.status,image:qr.image,error:qr.error||''}:null,jobs:s.jobs.slice(-30).reverse().map(({id,title,state,error,created_at,items=[]})=>({id,title,state,error,created_at,items}))};}
  function current(account){return read().account?.token===account.token;}
  function jobPatch(id,fn){patch(s=>{const j=s.jobs.find(j=>j.id===id);if(j)fn(j)});}
  async function processJob(job,signal){
    activeJob=job.id;jobPatch(job.id,j=>{j.state='working';j.error=''});
    try{
      await work(async()=>{
        signal.throwIfAborted();validateCollection(job.collection_id);
        const list=job.message.item_list||[];
        if(!list.length||list.length>64||list.some(i=>![1,2].includes(i.type)))throw fault('此消息含暂不支持的内容；目前接收文字、图片和图文消息');
        const text=list.filter(i=>i.type===1).map(i=>i.text_item?.text||'').join('\n\n');
        if(text.length>450000)throw fault('文字过长，请分开发送');
        const images=list.filter(i=>i.type===2);if(images.length>32)throw fault('一条消息最多接收 32 张图片');
        const note=!!text.trim(),noteId=weixinItemId(job.id),ids=[];
        // Deterministic IDs make replay safe even after a crash between inserting
        // content and recording completion. Deleted/edited content is never recreated.
        if(note&&exists(noteId)){jobPatch(job.id,j=>{j.items=[noteId];j.state='done';delete j.message});return;}
        let imageIndex=0;const content=[];
        for(const part of list){
          signal.throwIfAborted();
          if(part.type===1){content.push(part.text_item?.text||'');continue;}
          const index=imageIndex++,id=weixinItemId(job.id,index);let item=exists(id);
          if(item?.deleted_at)throw fault('这条消息的配图已在回收站，请恢复后重试');
          if(item&&item.collection_id!==job.collection_id)throw fault('这条消息的配图已移动到其他知识库，未重复保存');
          if(!item){const bytes=await client.image(part.image_item,signal);signal.throwIfAborted();item=await saveImage(bytes,{id,title:job.title+(images.length>1?' · '+(index+1):''),collection_id:job.collection_id,tags:job.tags,group_key:note?'note:'+noteId:'wechat:'+job.id,group_index:index,group_title:job.title,captured_at:job.created_at});}
          ids.push(item.id);content.push(`![微信配图 ${index+1}](/media/${item.id}/original)`);
        }
        signal.throwIfAborted();
        if(note){const item=saveNote({id:noteId,title:job.title,content:content.join('\n\n'),collection_id:job.collection_id,tags:job.tags,captured_at:job.created_at});ids.unshift(item.id);}
        if(!ids.length)throw fault('消息中没有可保存的文字或图片');
        jobPatch(job.id,j=>{j.items=ids;j.state='done';delete j.message});
      });
    }catch(e){jobPatch(job.id,j=>{j.state=signal.aborted?'pending':'failed';j.error=signal.aborted?'':(e.status&&e.status<500?e.message:'图片读取或保存失败，可重试；请检查微信连接和存储空间');});}
    finally{activeJob=null;}
  }
  async function tick(signal){
    const state=read();if(!state.enabled||!state.account)return;
    for(const job of state.jobs.filter(j=>['pending','working'].includes(j.state)&&(!j.owner||j.owner===state.account.user))){if(signal.aborted||!current(state.account)||!read().enabled)return;await processJob(job,signal);}
    if(signal.aborted||!current(state.account)||!read().enabled)return;
    if(read().jobs.filter(j=>j.message).length>=100)throw fault('微信收件箱已满，请处理或忽略失败消息');
    status='等待微信消息';const updates=await client.updates(state.account,state.cursor,signal);signal.throwIfAborted();
    if(!current(state.account)||!read().enabled||read().cursor!==state.cursor)return;
    if(!Array.isArray(updates.msgs||[])||(updates.msgs||[]).length>100)throw fault('微信单批消息超过处理上限');
    patch(s=>{
      for(const message of updates.msgs||[]){
        if((message.message_type!=null&&message.message_type!==1)||(message.message_state!=null&&message.message_state!==2)||message.delete_time_ms>0||message.group_id||message.from_user_id!==s.account.user)continue;
        const id=weixinMessageKey(message,s.account);if(s.jobs.some(j=>j.id===id))continue;
        const text=(message.item_list||[]).filter(i=>i.type===1).map(i=>i.text_item?.text||'').join(' ');
        const time=Number(message.create_time_ms),created_at=new Date(Number.isFinite(time)&&time>0&&time<Date.now()+86400000?time:Date.now()).toISOString();
        s.jobs.push({id,owner:s.account.user,title:text.trim().replace(/\s+/g,' ').slice(0,100)||'微信图片 '+created_at.slice(0,10),state:'pending',created_at,collection_id:s.collection_id,tags:[...new Set(['微信',...s.tags])],message});
      }
      if(typeof updates.get_updates_buf==='string'&&updates.get_updates_buf.length<100000)s.cursor=updates.get_updates_buf;
      const completed=s.jobs.filter(j=>!j.message).slice(-400),pending=s.jobs.filter(j=>j.message);if(pending.length>100)throw fault('微信收件箱已满');s.jobs=[...completed,...pending];
    });
  }
  function start(){
    if(loop||!read().enabled||!read().account)return;
    controller=new AbortController();const signal=controller.signal;
    loop=(async()=>{let failures=0;while(!signal.aborted&&read().enabled&&read().account){try{await tick(signal);failures=0;lastError='';}catch(e){if(signal.aborted)break;lastError=e.expired?e.message:(e.status===400?e.message:'微信暂时无法连接，正在重试');status='连接中断';if(e.expired){patch(s=>{s.enabled=false});break;}failures++;}await sleep(failures?Math.min(30000,1000*2**Math.min(failures,5)):500,undefined,{signal,ref:false}).catch(()=>{});}})().finally(()=>{loop=null;status=read().account?'已暂停':'未连接';});
  }
  async function stop(){controller?.abort();await loop;}
  async function configure(input){
    if(typeof input.enabled!=='boolean'||!(input.collection_id===null||typeof input.collection_id==='string')||!Array.isArray(input.tags)||input.tags.length>20||input.tags.some(t=>typeof t!=='string'||!t.trim()||t.length>40))throw fault('微信收件设置无效');
    validateCollection(input.collection_id);await stop();
    patch(s=>{s.enabled=input.enabled;s.collection_id=input.collection_id;s.tags=[...new Set(input.tags.map(t=>t.trim()))]});start();return publicState();
  }
  async function beginLogin(){
    if(qr&&!['expired','failed','confirmed','verify_code_blocked','binded_redirect'].includes(qr.status))return publicState();
    loginController?.abort();await loginWork;
    const control=loginController=new AbortController(),signal=control.signal;const data=await client.qr(signal);
    if(typeof data.qrcode!=='string'||typeof data.qrcode_img_content!=='string'||data.qrcode.length>4096||data.qrcode_img_content.length>12000)throw fault('微信二维码返回异常');
    const currentQr=qr={id:randomUUID(),value:data.qrcode,image:data.qrcode_img_content,status:'wait',base:API_BASE,created:Date.now(),code:''};
    loginWork=(async()=>{while(!signal.aborted&&qr===currentQr&&Date.now()-currentQr.created<240000){
      if(currentQr.status==='need_verifycode'&&!currentQr.code){await sleep(500,undefined,{signal,ref:false}).catch(()=>{});continue;}
      try{
        const result=await client.qrStatus(currentQr.value,{base:currentQr.base,code:currentQr.code,signal});if(signal.aborted||qr!==currentQr)return;
        currentQr.code='';currentQr.status=result.status;
        if(result.status==='scaned_but_redirect'){currentQr.base=weixinUrl('https://'+String(result.redirect_host).replace(/^https:\/\//,'')).origin;}
        if(result.status==='confirmed'){
          if(!result.bot_token||!result.ilink_bot_id||!result.ilink_user_id)throw fault('微信绑定信息不完整，请重试');
          const base=weixinUrl(result.baseurl||API_BASE).origin;await stop();
          patch(s=>{s.account={token:result.bot_token,bot:result.ilink_bot_id,user:result.ilink_user_id,base};s.cursor='';s.enabled=true;});currentQr.image='';start();return;
        }
        if(['expired','verify_code_blocked','binded_redirect'].includes(result.status))return;
      }catch(e){if(signal.aborted)return;currentQr.error=e.status===400?e.message:'微信连接失败，可重新生成二维码';currentQr.status='failed';return;}
      await sleep(1000,undefined,{signal,ref:false}).catch(()=>{});
    }if(qr===currentQr)currentQr.status='expired';})();
    return publicState();
  }
  async function disconnect(){loginController?.abort();await loginWork;await stop();qr=null;patch(s=>{s.enabled=false;s.account=null;s.cursor=''});lastError='';return publicState();}
  return {start,stop:async()=>{loginController?.abort();await loginWork;await stop();},status:publicState,configure,beginLogin,disconnect,tick,
    verify(id,code){if(!qr||qr.id!==id||qr.status!=='need_verifycode'||typeof code!=='string'||!/^\d{4,8}$/.test(code))throw fault('验证码或扫码会话无效');qr.code=code;return publicState();},
    retry(id){jobPatch(id,j=>{if(j.state!=='failed')throw fault('只能重试失败消息');if(j.owner&&j.owner!==read().account?.user)throw fault('请先连接收到该消息的微信账号');j.state='pending';j.error=''});start();return publicState();},
    skip(id){jobPatch(id,j=>{if(j.state!=='failed')throw fault('只能忽略失败消息');j.state='skipped';delete j.message});return publicState();},
  };
}
export function registerWeixinRoutes(app,admin,inbox){
  app.get('/api/weixin',admin,(req,res)=>res.json(inbox.status()));
  app.patch('/api/weixin',admin,async(req,res)=>res.json(await inbox.configure(req.body)));
  app.post('/api/weixin/login',admin,async(req,res)=>res.json(await inbox.beginLogin()));
  app.post('/api/weixin/verify',admin,(req,res)=>res.json(inbox.verify(req.body.id,req.body.code)));
  app.delete('/api/weixin/login',admin,async(req,res)=>res.json(await inbox.disconnect()));
  app.post('/api/weixin/jobs/:id/retry',admin,(req,res)=>res.json(inbox.retry(req.params.id)));
  app.post('/api/weixin/jobs/:id/skip',admin,(req,res)=>res.json(inbox.skip(req.params.id)));
}
