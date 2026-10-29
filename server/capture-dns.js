import {lookup as systemLookup} from 'node:dns/promises';
import {setTimeout as sleep} from 'node:timers/promises';
import {captureDohProviders,createDohLookup,dnsName} from './capture-doh.js';

const temporary=new Set(['ENOTFOUND','EAI_AGAIN','ETIMEOUT','ETIMEDOUT','CAPTURE_DNS_TIMEOUT']);
// Windows getaddrinfo can briefly return ENOTFOUND while a connection wakes.
// Retry only resolution: never replay uploads, restart jobs or change OS DNS.
// Callers still validate every returned address and pin each redirect target.
export function createCaptureHostResolver({lookup=systemLookup,pause=(ms,signal)=>sleep(ms,undefined,{signal}),timeoutMs=1500,dohTimeoutMs=3500,fallbacks=captureDohProviders,dohLookup=createDohLookup(),now=Date.now,report=event=>console.warn('[capture_dns]',JSON.stringify(event))}={}){
  const cache=new Map();
  async function bounded(operation,signal,ms){
    signal?.throwIfAborted();
    return new Promise((resolve,reject)=>{
      let settled=false;const controller=new AbortController(),combined=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
      const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);combined.removeEventListener('abort',abort);error?reject(error):resolve(result)};
      const abort=()=>finish(combined.reason);
      const timer=setTimeout(()=>controller.abort(Object.assign(Error('域名解析超时'),{code:'CAPTURE_DNS_TIMEOUT'})),ms);
      combined.addEventListener('abort',abort,{once:true});
      Promise.resolve().then(()=>{combined.throwIfAborted();return operation(combined)}).then(result=>finish(null,result),error=>finish(error));
    });
  }
  return async(host,{signal}={})=>{
    let lastError;const start=now();
    for(let attempt=0;attempt<3;attempt++){
      try{const addresses=await bounded(()=>lookup(host,{all:true}),signal,timeoutMs);signal?.throwIfAborted();cache.delete(host);return addresses;}
      catch(error){
        signal?.throwIfAborted();
        if(!temporary.has(error?.code))throw error;
        lastError=error;
        const cached=cache.get(host);if(cached?.expires>now())return cached.addresses.map(row=>({...row}));cache.delete(host);
        if(attempt<2)await pause(attempt===0?300:900,signal);
      }
    }
    // Never send LAN/private hostnames to a public DNS service. A resolved
    // private IP is returned as before and rejected by the resource downloader.
    const name=dnsName(host),publicName=name.includes('.')&&!/(?:^|\.)(?:localhost|local|internal|lan|home|arpa|onion)$/.test(name);
    report({host:name,resolver:'system',code:lastError.code,ms:now()-start});
    if(publicName)for(const provider of fallbacks){
      const begin=now();
      try{
        const result=await bounded(inner=>dohLookup(provider,name,{signal:inner}),signal,dohTimeoutMs);signal?.throwIfAborted();
        if(!result.addresses?.length)throw Object.assign(Error('备用 DNS 没有返回地址'),{code:'ENODATA'});
        if(result.ttl>0){for(const [key,value] of cache)if(value.expires<=now())cache.delete(key);if(cache.size>=256)cache.delete(cache.keys().next().value);cache.set(host,{addresses:result.addresses.map(row=>({...row})),expires:now()+Math.min(result.ttl,60)*1000});}
        report({host:name,resolver:provider.name,code:'OK',ms:now()-begin});return result.addresses;
      }catch(error){signal?.throwIfAborted();lastError=error;report({host:name,resolver:provider.name,code:error.code||'DOH_FAILED',ms:now()-begin});}
    }
    throw Object.assign(Error('系统与备用 DNS 均未能解析资源域名，请稍后重试',{cause:lastError}),{status:502,code:'CAPTURE_DNS_FAILED',hostname:name});
  };
}
export const resolveCaptureHost=createCaptureHostResolver();
