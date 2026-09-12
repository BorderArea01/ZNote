import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
const MAX = 25*1024*1024;
export function publicAddress(address) {
  if(isIP(address)===4) {
    const [a,b]=address.split('.').map(Number);
    return !(a===0 || a===10 || a===127 || a>=224 || a===169&&b===254 || a===172&&b>=16&&b<=31 || a===192&&b===168 || a===100&&b>=64&&b<=127 || a===198&&(b===18||b===19));
  }
  // Only global unicast IPv6; excludes loopback, mapped IPv4 and link-local ranges.
  return isIP(address)===6 && /^[23]/i.test(address) && !/^(?:2002:|2001:(?:db8|0:|:|10:|20:))/i.test(address);
}
export async function fetchRemoteImage(value, redirects=0) {
  if(value.startsWith('data:image/')) {
    const m=/^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i.exec(value);
    if(!m) throw Error('仅支持 Base64 图片');
    const buffer=Buffer.from(m[2],'base64'); if(buffer.length>MAX) throw Error('图片超过 25 MB'); return buffer;
  }
  const url=new URL(value);
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password) throw Error('图片地址无效');
  const host=url.hostname.replace(/^\[|\]$/g,''), addresses=isIP(host)?[{address:host,family:isIP(host)}]:await lookup(host,{all:true});
  if(!addresses.length || addresses.some(v=>!publicAddress(v.address))) throw Error('服务器不能采集本机或内网图片地址，请通过上传归档');
  const target=addresses[0];
  return new Promise((resolve,reject)=>{
    const headers={Accept:'image/*', 'Accept-Encoding':'identity'};
    if(/(^|\.)pximg\.net$/.test(host)) headers.Referer='https://www.pixiv.net/';
    const req=(url.protocol==='https:'?httpsRequest:httpRequest)(url,{headers,
      lookup:(_host,options,callback)=>options.all?callback(null,[target]):callback(null,target.address,target.family)},res=>{
      if([301,302,303,307,308].includes(res.statusCode)) {
        res.resume(); if(redirects>=3 || !res.headers.location) return reject(Error('图片重定向过多'));
        fetchRemoteImage(new URL(res.headers.location,url).href,redirects+1).then(resolve,reject);return;
      }
      if(res.statusCode!==200) {res.resume();reject(Error(`图片读取失败 HTTP ${res.statusCode}`));return;}
      if(Number(res.headers['content-length'])>MAX){res.destroy();reject(Error('图片超过 25 MB'));return;}
      const type=res.headers['content-type']||'';
      if(type && !/^(image\/|application\/octet-stream)/i.test(type)){res.destroy();reject(Error('地址未返回图片'));return;}
      const chunks=[];let size=0;
      res.on('data',chunk=>{size+=chunk.length;if(size>MAX){res.destroy();reject(Error('图片超过 25 MB'));}else chunks.push(chunk);});
      res.on('end',()=>resolve(Buffer.concat(chunks)));res.on('error',reject);
    });
    const timer=setTimeout(()=>req.destroy(Error('图片下载超时')),15000);
    req.on('close',()=>clearTimeout(timer));req.on('error',reject);req.end();
  });
}
