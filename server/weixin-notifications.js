import {createHash,randomUUID} from 'node:crypto';
import {z} from 'zod';
import {createWeixinClient} from './weixin-client.js';

const CONFIG='weixin_notifications_v1',CONTEXT='weixin_notification_context_v1',RECEIPTS='weixin_notification_receipts_v1';
const digest=value=>createHash('sha256').update(value).digest('hex');
const binding=account=>account?digest(JSON.stringify([account.bot,account.user,account.token])):null;
const failure=(status,message)=>Object.assign(Error(message),{status});
const inputSchema=z.object({
  idempotency_key:z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/),
  title:z.string().trim().min(1).max(100).refine(value=>!/[\r\n\x00-\x1f]/.test(value)),
  body:z.string().trim().min(1).max(1500),
}).strict();

/** Outbound-only adapter. It never polls Weixin, touches notes or changes the
 * inbox account/cursor/configuration. Only the existing inbox supplies context. */
export function createWeixinNotifications({db,client=createWeixinClient(),clock=Date.now}){
  const read=(key,fallback)=>{const row=db.prepare('SELECT value FROM settings WHERE key=?').get(key);return row?JSON.parse(row.value):fallback;};
  const write=(key,value)=>db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,JSON.stringify(value));
  const account=()=>read('weixin_inbox_v1',{}).account;
  const config=()=>read(CONFIG,{enabled:false});
  const rows=()=>read(RECEIPTS,[]);
  const active=new Set();
  let busy=false;
  const publicReceipt=row=>({idempotency_key:row.key,status:row.status==='sending'&&!active.has(row.id)?'unknown':row.status,created_at:row.created_at,updated_at:row.updated_at,detail:row.status==='sending'&&!active.has(row.id)?'上次发送未取得结果，未自动重发。':row.detail});
  function readiness(){
    const a=account(),context=read(CONTEXT,null);
    if(!config().enabled)return {ready:false,reason:'通知发送未启用。'};
    if(!a)return {ready:false,reason:'尚未绑定微信；不会自动重新扫码。'};
    if(!context||context.binding!==binding(a))return {ready:false,reason:'需要绑定用户先向现有 ClawBot 发送一条正常收件消息，以取得发送上下文。'};
    return {ready:true,reason:'已具备发送条件；实际结果以微信接口响应为准。',context_received_at:context.received_at};
  }
  function status(){return {...readiness(),enabled:config().enabled,busy,receipts:rows().slice(-30).reverse().map(publicReceipt)};}
  function configure(input){
    const {enabled}=z.object({enabled:z.boolean()}).strict().parse(input);
    write(CONFIG,{enabled});return status();
  }
  function captureContext(message,a){
    if(!a||binding(account())!==binding(a)||message.from_user_id!==a.user||message.group_id||message.delete_time_ms>0||
      (message.message_type!=null&&message.message_type!==1)||(message.message_state!=null&&message.message_state!==2))return;
    const token=message.context_token;
    if(typeof token!=='string'||!token||token.length>16384)return;
    const prior=read(CONTEXT,null);
    if(prior?.binding===binding(a)&&prior.token===token)return;
    write(CONTEXT,{binding:binding(a),token,received_at:new Date(clock()).toISOString()});
  }
  const ownerId=auth=>auth.scope==='admin'?'admin':auth.id;
  const lookup=(owner,key)=>rows().find(row=>row.id===digest(owner+'\n'+key));
  function receipt(auth,key){const row=lookup(ownerId(auth),key);if(!row)throw failure(404,'通知记录不存在');return publicReceipt(row);}
  async function send(auth,input){
    const value=inputSchema.parse(input),owner=ownerId(auth),id=digest(owner+'\n'+value.idempotency_key);
    const hash=digest(JSON.stringify([value.title,value.body]));
    const previous=lookup(owner,value.idempotency_key);
    if(previous){if(previous.hash!==hash)throw failure(409,'同一通知编号不能用于不同内容');return publicReceipt(previous);}
    const ready=readiness();if(!ready.ready)throw failure(409,ready.reason);
    if(busy)throw failure(429,'通知通道正在发送，请稍后使用同一编号重试');
    const existing=rows(),now=clock();
    // Never evict still-valid deduplication receipts merely to admit more sends.
    const retained=existing.filter(row=>now-Date.parse(row.created_at)<30*86400000||active.has(row.id));
    if(retained.length>=1000)throw failure(429,'通知记录达到本月容量，请稍后重试');
    const last=retained.at(-1);if(last&&now-Date.parse(last.created_at)<3000)throw failure(429,'通知发送过于频繁，请稍后使用同一编号重试');
    const a=account(),context=read(CONTEXT,null),time=new Date(now).toISOString();
    const row={id,key:value.idempotency_key,hash,status:'sending',created_at:time,updated_at:time,detail:'正在提交微信，尚未取得结果。'};
    // Persist intent before touching the network; an uncertain request is never
    // blindly replayed after restart. Body and credentials are not in receipts.
    write(RECEIPTS,[...retained,row]);active.add(id);busy=true;
    try{
      const response=await client.sendText(a,{text:`${value.title}\n${value.body}`,contextToken:context.token,clientId:'znote-notify-'+randomUUID()});
      if(response?.accepted!==true)throw Error('Missing acceptance');
      row.status='accepted';row.detail='微信接口已接受；不代表手机已展示或用户已读。';
    }catch(error){
      row.status=Number.isInteger(error.weixinCode)?'rejected':'unknown';
      row.detail=error.weixinCode===-2?'微信拒绝发送（-2），请在原会话发送一条消息更新上下文后检查。':error.weixinCode===-14?'微信报告授权过期；原收件设置未改变，请在设置中检查连接。':Number.isInteger(error.weixinCode)?`微信拒绝发送（${error.weixinCode}）。`:'网络或返回结果异常，发送结果未确认；未自动重发。';
    }finally{
      row.updated_at=new Date(clock()).toISOString();
      try{write(RECEIPTS,rows().map(item=>item.id===id?row:item));}finally{busy=false;active.delete(id);}
    }
    return publicReceipt(row);
  }
  return {status,configure,captureContext,send,receipt};
}

export function registerWeixinNotificationRoutes(app,admin,notifications){
  const sender=(req,res,next)=>['admin','notify'].includes(req.auth.scope)?next():next(failure(403,'需要管理员或仅通知令牌'));
  app.get('/api/weixin/notifications',admin,(req,res)=>res.json(notifications.status()));
  app.patch('/api/weixin/notifications',admin,(req,res)=>res.json(notifications.configure(req.body)));
  app.get('/api/weixin/notifications/:key',sender,(req,res)=>res.json(notifications.receipt(req.auth,req.params.key)));
  app.post('/api/weixin/notifications',sender,async(req,res)=>{
    const result=await notifications.send(req.auth,req.body);
    const code=result.status==='accepted'?200:result.status==='sending'?202:result.status==='rejected'?502:504;
    res.status(code).json({...result,...(code>=400?{error:result.detail}:{})});
  });
}
