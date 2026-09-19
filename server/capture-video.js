import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
import {request as httpRequest} from 'node:http';
import {request as httpsRequest} from 'node:https';
import {createWriteStream} from 'node:fs';
import {unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {publicAddress} from './remote-images.js';
import {MAX_VIDEO_BYTES} from './videos.js';
import {proxyAgent} from './network-proxy.js';
const fail=message=>Object.assign(Error(message),{status:422});

// Stream the exact playback resource advertised by the matching work, with the
// same public-address validation and DNS pinning as page/image collection.
async function transfer(value,path,source,signal,redirects=0){
  const url=new URL(value),host=url.hostname.replace(/^\[|\]$/g,'');
  if(!/^https?:$/.test(url.protocol)||url.username||url.password||url.port&&!['80','443'].includes(url.port))throw fail('视频资源地址无效');
  const addresses=isIP(host)?[{address:host,family:isIP(host)}]:await lookup(host,{all:true});
  if(!addresses.length||addresses.some(v=>!publicAddress(v.address)))throw fail('不能采集本机或内网视频');
  signal.throwIfAborted();const target=addresses[0];
  const response=await new Promise((resolve,reject)=>{
    const agent=proxyAgent();
    const options={signal,headers:{'User-Agent':'Mozilla/5.0','Accept-Encoding':'identity',Referer:source},...(agent?{agent}:{lookup:(_h,o,cb)=>o.all?cb(null,[target]):cb(null,target.address,target.family)})};
    const req=(url.protocol==='https:'?httpsRequest:httpRequest)(url,options,resolve);
    req.setTimeout(20000,()=>req.destroy(fail('视频读取超时')));req.on('error',reject);req.end();
  });
  if([301,302,303,307,308].includes(response.statusCode)){
    response.destroy();if(redirects>=5||!response.headers.location)throw fail('视频资源跳转过多');
    return transfer(new URL(response.headers.location,url).href,path,source,signal,redirects+1);
  }
  if(response.statusCode!==200){response.destroy();throw fail(`视频资源无法读取（HTTP ${response.statusCode}）`);}
  if(Number(response.headers['content-length'])>MAX_VIDEO_BYTES){response.destroy();throw fail('视频超过 500 MB');}
  if(/text\/|application\/json/i.test(response.headers['content-type']||'')){response.destroy();throw fail('平台返回了验证页面，未取得视频文件');}
  let size=0;const limit=new Transform({transform(chunk,_enc,done){size+=chunk.length;done(size>MAX_VIDEO_BYTES?fail('视频超过 500 MB'):null,chunk);}});
  await pipeline(response,limit,createWriteStream(path),{signal});
  if(!size)throw fail('平台返回了空的视频文件');
}
export async function downloadCaptureVideo({plan,dir,signal,progress}){
  const path=join(dir,'media.mp4');let error;
  for(const url of plan.video_urls||[]){
    signal.throwIfAborted();progress('正在保存作品播放视频');
    try{await transfer(url,path,plan.url,signal);return {path,originalname:'media.mp4',title:plan.title,author:plan.author,description:plan.description||''};}
    catch(e){error=e;await unlink(path).catch(()=>{});}
  }
  throw error||fail('作品没有提供可下载的视频地址');
}
