import { lookup } from 'node:dns/promises';
import {createCaptureHostResolver} from './capture-dns.js';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { MAX_IMAGE_BYTES } from './image-limits.js';
import { proxyAgent,resetProxyCache } from './network-proxy.js';
import {ehSite,ehPolicy} from './capture-eh-policy.js';
const MAX = MAX_IMAGE_BYTES;
export function publicAddress(address) {
  if(isIP(address)===4) {
    const [a,b]=address.split('.').map(Number);
    return !(a===0 || a===10 || a===127 || a>=224 || a===169&&b===254 || a===172&&b>=16&&b<=31 || a===192&&b===168 || a===100&&b>=64&&b<=127 || a===198&&(b===18||b===19));
  }
  // Only global unicast IPv6; excludes loopback, mapped IPv4 and link-local ranges.
  return isIP(address)===6 && /^[23]/i.test(address) && !/^(?:2002:|2001:(?:db8|0:|:|10:|20:))/i.test(address);
}
const transient=error=>['ETIMEDOUT','ECONNREFUSED','ECONNRESET','EAI_AGAIN','ENETUNREACH','EHOSTUNREACH','IMAGE_DOWNLOAD_TIMEOUT','IMAGE_BODY_INCOMPLETE','IMAGE_HTTP_502','IMAGE_HTTP_503','IMAGE_HTTP_504'].includes(error?.code);
export function createRemoteImageFetcher({lookup:resolveAddresses=lookup,request:requestOverride,proxyAgent:getAgent=proxyAgent,resetProxyCache:refreshProxy=resetProxyCache,timeoutMs=15000}={}) {
const resolveHost=createCaptureHostResolver({lookup:resolveAddresses});
async function once(value, redirects) {
  if(value.startsWith('data:image/')) {
    const m=/^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i.exec(value);
    if(!m) throw Error('仅支持 Base64 图片');
    const buffer=Buffer.from(m[2],'base64'); if(buffer.length>MAX) throw Error('图片超过 100 MB'); return buffer;
  }
  const url=new URL(value);
  ehPolicy.check(value);
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password) throw Error('图片地址无效');
  const host=url.hostname.replace(/^\[|\]$/g,''), addresses=isIP(host)?[{address:host,family:isIP(host)}]:await resolveHost(host);
  if(!addresses.length || addresses.some(v=>!publicAddress(v.address))) throw Error('服务器不能采集本机或内网图片地址，请通过上传归档');
  const target=addresses[0];
  return new Promise((resolve,reject)=>{
    let req,response,settled=false,redirecting=false,timer;
    const finish=(error,buffer)=>{if(settled)return;settled=true;clearTimeout(timer);if(error){response?.destroy();req?.destroy();reject(error);}else resolve(buffer);};
    const headers={Accept:'image/*', 'Accept-Encoding':'identity'};
    if(/(^|\.)pximg\.net$/.test(host)) headers.Referer='https://www.pixiv.net/';
    if(host==='cdn.readdetectiveconan.com') headers.Referer='https://mangapill.com/';
    const agent = getAgent();
    const options = {headers, ...(agent ? {agent} : {lookup:(_host,options,callback)=>options.all?callback(null,[target]):callback(null,target.address,target.family)})};
    req=(requestOverride||(url.protocol==='https:'?httpsRequest:httpRequest))(url,options,res=>{
      response=res;
      if([301,302,303,307,308].includes(res.statusCode)) {
        if(redirects>=3 || !res.headers.location)return finish(Error('图片重定向过多'));
        let next;try{next=new URL(res.headers.location,url).href;}catch(error){return finish(error);}
        redirecting=true;res.destroy();clearTimeout(timer);
        once(next,redirects+1).then(buffer=>finish(null,buffer),finish);return;
      }
      if(res.statusCode!==200) {finish(Object.assign(Error(`图片读取失败 HTTP ${res.statusCode}`),{code:'IMAGE_HTTP_'+res.statusCode}));return;}
      if(Number(res.headers['content-length'])>MAX){finish(Error('图片超过 100 MB'));return;}
      const type=res.headers['content-type']||'';
      if(type && !/^(image\/|application\/octet-stream)/i.test(type)){
        if(ehSite(value)&&/^text\//i.test(type)){
          const chunks=[];let length=0;
          res.on('data',chunk=>{length+=chunk.length;if(length>16384){finish(Error('地址未返回图片'));}else chunks.push(chunk);});
          res.on('end',()=>finish(ehPolicy.response(value,Buffer.concat(chunks))||Error('地址未返回图片')));res.on('error',finish);
        }else{finish(Error('地址未返回图片'));}
        return;
      }
      const chunks=[];let size=0;
      res.on('data',chunk=>{size+=chunk.length;if(size>MAX){finish(Error('图片超过 100 MB'));}else chunks.push(chunk);});
      res.on('end',()=>finish(null,Buffer.concat(chunks)));res.on('error',finish);
      res.on('aborted',()=>finish(Object.assign(Error('图片传输中断'),{code:'IMAGE_BODY_INCOMPLETE'})));
    });
    timer=setTimeout(()=>finish(Object.assign(Error('图片下载超时'),{code:'IMAGE_DOWNLOAD_TIMEOUT'})),timeoutMs);
    req.on('error',error=>{if(!redirecting)finish(error);});req.end();
  });
}
return async(value,redirects=0)=>{
  for(let attempt=0;attempt<2;attempt++){
    try{return await once(value,redirects);}catch(error){if(attempt||!transient(error))throw error;refreshProxy();}
  }
};
}
export const fetchRemoteImage=createRemoteImageFetcher();
