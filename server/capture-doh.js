import {request as httpsRequest} from 'node:https';
import {isIP} from 'node:net';
import {domainToASCII} from 'node:url';
import {proxyAgent} from './network-proxy.js';

// Fixed HTTPS origins only. Bootstrap addresses avoid depending on the broken
// system resolver to find the fallback itself. TLS still verifies the hostname.
export const captureDohProviders=Object.freeze([
  Object.freeze({name:'dnspod',host:'doh.pub',bootstrap:['1.12.12.12','120.53.53.53'],proxy:false}),
  Object.freeze({name:'cloudflare',host:'cloudflare-dns.com',bootstrap:['1.1.1.1','1.0.0.1'],proxy:true}),
]);
const failure=(code,message)=>Object.assign(Error(message),{code});
export function dnsName(value){
  if(typeof value!=='string')throw failure('EINVAL','资源域名无效');
  const name=domainToASCII(value.replace(/\.$/,'').toLowerCase());
  if(!name||name.length>253||!name.split('.').every(label=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)))throw failure('EINVAL','资源域名无效');
  return name;
}
export function dohAnswer(data,host,type){
  const name=dnsName(host),family=type===1?4:6;
  if(!data||!Number.isInteger(data.Status)||data.TC===true||data.Question?.length!==1||dnsName(data.Question[0].name)!==name||data.Question[0].type!==type)throw failure('DOH_INVALID_RESPONSE','备用 DNS 返回了不匹配的数据');
  if(data.Status!==0)throw failure('DOH_RCODE_'+data.Status,'备用 DNS 未能解析该域名');
  const answers=data.Answer||[];
  if(!Array.isArray(answers)||answers.length>128)throw failure('DOH_INVALID_RESPONSE','备用 DNS 响应无效');
  const owners=new Set([name]);let ttl=60;
  // Follow only this question's CNAME chain, never unrelated answer/additional
  // records. The caller validates every returned IP, including mixed answers.
  for(let step=0;step<16;step++){
    let changed=false;
    for(const record of answers)if(record.type===5&&owners.has(dnsName(record.name))){
      const target=dnsName(record.data);ttl=Math.min(ttl,Number.isInteger(record.TTL)&&record.TTL>=0?record.TTL:0);
      if(!owners.has(target)){owners.add(target);changed=true;}
    }
    if(!changed)break;
  }
  const addresses=[];
  for(const record of answers)if(record.type===type&&owners.has(dnsName(record.name))){
    if(isIP(record.data)!==family)throw failure('DOH_INVALID_RESPONSE','备用 DNS 返回了无效地址');
    ttl=Math.min(ttl,Number.isInteger(record.TTL)&&record.TTL>=0?record.TTL:0);
    if(!addresses.some(row=>row.address===record.data))addresses.push({address:record.data,family});
  }
  return {addresses,ttl};
}

export function createDohLookup({request=httpsRequest,getProxy=proxyAgent}={}){
  async function query(provider,host,type,signal){
    const url=new URL('https://'+provider.host+'/dns-query');url.searchParams.set('name',host);url.searchParams.set('type',String(type));
    const agent=provider.proxy?getProxy():undefined;let lastError;
    for(const address of agent?[null]:provider.bootstrap){
      signal.throwIfAborted();
      try{return await new Promise((resolve,reject)=>{
        let req,response,settled=false;
        const finish=(error,value)=>{if(settled)return;settled=true;if(error){response?.destroy();req?.destroy();reject(error);}else resolve(value);};
        const options={method:'GET',signal,headers:{Accept:'application/dns-json','Accept-Encoding':'identity'},servername:provider.host,...(agent?{agent}:{agent:false,lookup:(_host,opts,cb)=>opts.all?cb(null,[{address,family:4}]):cb(null,address,4)})};
        req=request(url,options,res=>{
          response=res;
          if(res.statusCode!==200)return finish(failure('DOH_HTTP_'+res.statusCode,'备用 DNS 请求失败'));
          if(!/^(application\/dns-json|application\/json)(?:;|$)/i.test(res.headers['content-type']||'')||Number(res.headers['content-length']||0)>65536)return finish(failure('DOH_INVALID_RESPONSE','备用 DNS 响应格式无效'));
          const chunks=[];let size=0;
          res.on('data',chunk=>{size+=chunk.length;if(size>65536)finish(failure('DOH_INVALID_RESPONSE','备用 DNS 响应过大'));else chunks.push(chunk);});
          res.on('error',finish);res.on('aborted',()=>finish(failure('DOH_INCOMPLETE','备用 DNS 响应中断')));
          res.on('end',()=>{if(settled)return;try{finish(null,dohAnswer(JSON.parse(Buffer.concat(chunks).toString('utf8')),host,type));}catch(error){finish(error);}});
        });
        req.on('error',finish);req.end();
      });}catch(error){signal.throwIfAborted();lastError=error;}
    }
    throw lastError;
  }
  return async(provider,host,{signal})=>{
    // A and AAAA share the caller's bounded provider budget. IPv6-only hosts
    // remain supported; DNS failure of one family does not discard the other.
    const results=await Promise.allSettled([query(provider,host,1,signal),query(provider,host,28,signal)]);
    signal.throwIfAborted();const valid=results.filter(r=>r.status==='fulfilled').map(r=>r.value);
    const addresses=valid.flatMap(r=>r.addresses);
    if(!addresses.length)throw results.find(r=>r.status==='rejected')?.reason||failure('ENODATA','备用 DNS 没有返回资源地址');
    return {addresses,ttl:Math.min(...valid.filter(r=>r.addresses.length).map(r=>r.ttl))};
  };
}
