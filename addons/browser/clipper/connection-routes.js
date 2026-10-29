// One route is selected before an operation. Writes are never replayed on a
// second server: the request may already have reached the first queue.
export const normalizeServer=value=>{
  const url=new URL(value);
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw Error('请输入 HTTP(S) 服务器地址');
  return url.href.replace(/\/$/,'');
};
export async function requestAt(config,path,options={}){
  if(!config.token)throw Error('请先打开连接设置，填写 ZNote 写入令牌');
  const response=await fetch(normalizeServer(config.server)+path,{...options,credentials:'omit',redirect:'error',headers:{...options.headers,Authorization:'Bearer '+config.token},signal:options.signal||AbortSignal.timeout(30000)});
  let data;try{data=await response.json();}catch{throw Error('服务器未返回有效响应，请检查地址');}
  if(!response.ok)throw Object.assign(Error(data.error||`请求失败 ${response.status}`),{status:response.status});
  return data;
}
export async function routeConnection(config,{localOnly=false,signal}={}){
  if(!config.remoteServer||!config.remoteToken)return {...config,remote:false};
  if(normalizeServer(config.server)===normalizeServer(config.remoteServer))throw Error('本机和远程备用入口不能相同');
  if(config.token){
    try{
      const timeout=AbortSignal.timeout(1200),probeSignal=signal?AbortSignal.any([signal,timeout]):timeout;
      const health=await requestAt(config,'/api/health',{signal:probeSignal});
      if(health.status==='ok'&&health.version&&health.mode!=='remote-capture'){
        const me=await requestAt(config,'/api/me',{signal:probeSignal});
        if(['write','admin'].includes(me.scope))return {...config,remote:false};
      }
    }catch(error){if(signal?.aborted)throw signal.reason||error;}
  }
  if(localOnly)throw Error('本机知识库暂不可达；Cloudflare 备用只支持作品链接，截图、文件上传和下载解析需要直连知识库');
  return {...config,server:normalizeServer(config.remoteServer),token:config.remoteToken,remote:true};
}
export const remotePathAllowed=path=>path==='/api/collections'||/^\/api\/captures(?:\/[a-f\d-]{36}(?:\/retry)?)?$/.test(path);
export function remoteCapture(input){
  // Do not send logged-in HTML, extracted media, cookies or local credentials
  // to the link-only inbox. The server parses the shared URL as on Android.
  return Object.fromEntries(['text','collection_id','image_mode','tags','request_id'].filter(key=>input[key]!==undefined).map(key=>[key,input[key]]));
}
