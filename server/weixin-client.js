import {createDecipheriv,randomBytes} from 'node:crypto';
// Wire format and CDN key encodings follow Tencent/openclaw-weixin (MIT).
// See addons/connectors/weixin/README.md for the pinned reference and attribution.
export const API_BASE='https://ilinkai.weixin.qq.com';
const CDN_BASE='https://novac2c.cdn.weixin.qq.com/c2c';
const VERSION='2.4.9';
export function weixinUrl(value,{cdn=false}={}){
  const u=new URL(value);
  const allowed=cdn ? (u.hostname.endsWith('.weixin.qq.com')||u.hostname.endsWith('.wx.qq.com')) : (u.hostname==='ilinkai.weixin.qq.com'||/^ilink[a-z0-9-]*\.weixin\.qq\.com$/.test(u.hostname));
  if(u.protocol!=='https:'||u.username||u.password||u.port||!allowed)throw Error('微信返回了不支持的服务地址');
  return u;
}
export function decodeWeixinImage(bytes,image){
  let key;
  if(image.aeskey){if(!/^[\da-f]{32}$/i.test(image.aeskey))throw Error('图片解密信息无效');key=Buffer.from(image.aeskey,'hex');}
  else if(image.media?.aes_key){key=Buffer.from(image.media.aes_key,'base64');if(key.length===32&&/^[\da-f]{32}$/i.test(key.toString('ascii')))key=Buffer.from(key.toString('ascii'),'hex');if(key.length!==16)throw Error('图片解密信息无效');}
  if(!key){if(image.media?.encrypt_type===1)throw Error('图片缺少解密密钥');return bytes;}
  const cipher=createDecipheriv('aes-128-ecb',key,null);
  try{return Buffer.concat([cipher.update(bytes),cipher.final()]);}catch{throw Error('微信图片解密失败');}
}
async function limited(response,max){
  if(!response.ok){await response.body?.cancel();throw Error('微信服务返回 HTTP '+response.status);}
  if(Number(response.headers.get('content-length'))>max){await response.body?.cancel();throw Error('微信内容超过大小限制');}
  const reader=response.body.getReader(),parts=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max)throw Error('微信内容超过大小限制');parts.push(value);}return Buffer.concat(parts);}finally{await reader.cancel();}
}
export function createWeixinClient({fetcher=fetch}={}){
  const headers=()=>({'Content-Type':'application/json','iLink-App-Id':'bot','iLink-App-ClientVersion':String((2<<16)|(4<<8)|9)});
  async function request(path,{base=API_BASE,account,body={},signal,get=false,timeout=40000,metadata=true}={}){
    const url=new URL(path,weixinUrl(base));const h=headers();
    if(!get){h.AuthorizationType='ilink_bot_token';h['X-WECHAT-UIN']=Buffer.from(String(randomBytes(4).readUInt32BE())).toString('base64');if(account)h.Authorization='Bearer '+account.token;}
    const response=await fetcher(url,{method:get?'GET':'POST',headers:h,redirect:'error',signal:AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(timeout)]),...(!get?{body:JSON.stringify({...body,...(metadata?{base_info:{channel_version:VERSION,bot_agent:'ZNote/0.9.29'}}:{})})}:{})});
    const raw=await limited(response,2*1024*1024);let result;
    try{result=JSON.parse(raw,(key,value,context)=>['message_id','msg_id','svr_id'].includes(key)&&typeof value==='number'&&/^\d+$/.test(context?.source||'')?context.source:value);}catch{throw Error('微信返回了无法识别的数据');}
    const code=result.errcode||result.ret;
    if(code)throw Object.assign(Error(code===-14?'微信连接已过期，请重新扫码':'微信请求失败（'+String(code).slice(0,20)+'）'),{expired:code===-14,weixinCode:Number.isInteger(code)?code:null});
    return result;
  }
  return {
    qr:signal=>request('/ilink/bot/get_bot_qrcode?bot_type=3',{body:{local_token_list:[]},metadata:false,signal,timeout:15000}),
    qrStatus:(qr,{base=API_BASE,code='',signal}={})=>request('/ilink/bot/get_qrcode_status?qrcode='+encodeURIComponent(qr)+(code?'&verify_code='+encodeURIComponent(code):''),{base,get:true,signal}),
    updates:(account,cursor,signal)=>request('/ilink/bot/getupdates',{base:account.base,account,body:{get_updates_buf:cursor||''},signal}),
    async sendText(account,{text,contextToken,clientId},signal){
      const result=await request('/ilink/bot/sendmessage',{base:account.base,account,signal,timeout:15000,body:{msg:{from_user_id:'',to_user_id:account.user,client_id:clientId,message_type:2,message_state:2,item_list:[{type:1,text_item:{text}}],context_token:contextToken}}});
      // HTTP 200 alone is not a delivery receipt. Never infer acceptance from
      // an empty body or invent a read/delivery acknowledgement.
      if(result.ret!==0)throw Error('微信未返回明确的发送接受结果');
      return {accepted:true};
    },
    async image(image,signal){
      const media=image?.media;if(!media)throw Error('这条图片消息缺少原文件');
      const url=weixinUrl(media.full_url||(media.encrypt_query_param?CDN_BASE+'/download?encrypted_query_param='+encodeURIComponent(media.encrypt_query_param):''),{cdn:true});
      const response=await fetcher(url,{redirect:'error',signal:AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(30000)])});
      const bytes=decodeWeixinImage(await limited(response,25*1024*1024+16),image);if(bytes.length>25*1024*1024)throw Error('单张图片不能超过 25 MB');return bytes;
    },
  };
}
