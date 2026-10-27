import {lookup as systemLookup} from 'node:dns/promises';
import {setTimeout as sleep} from 'node:timers/promises';

const temporary=new Set(['ENOTFOUND','EAI_AGAIN','ETIMEOUT','ETIMEDOUT','CAPTURE_DNS_TIMEOUT']);
// Windows getaddrinfo can briefly return ENOTFOUND while a connection wakes.
// Retry only resolution: never replay uploads, restart jobs or change OS DNS.
// Callers still validate every returned address and pin each redirect target.
export function createCaptureHostResolver({lookup=systemLookup,pause=(ms,signal)=>sleep(ms,undefined,{signal}),timeoutMs=4000}={}){
  async function once(host,signal){
    signal?.throwIfAborted();
    return new Promise((resolve,reject)=>{
      let settled=false;
      const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);error?reject(error):resolve(result)};
      const abort=()=>finish(signal.reason);
      const timer=setTimeout(()=>finish(Object.assign(Error('域名解析超时'),{code:'CAPTURE_DNS_TIMEOUT'})),timeoutMs);
      signal?.addEventListener('abort',abort,{once:true});
      Promise.resolve().then(()=>{signal?.throwIfAborted();return lookup(host,{all:true})}).then(result=>finish(null,result),error=>finish(error));
    });
  }
  return async(host,{signal}={})=>{
    for(let attempt=0;attempt<3;attempt++){
      try{const addresses=await once(host,signal);signal?.throwIfAborted();return addresses;}
      catch(error){
        signal?.throwIfAborted();
        if(!temporary.has(error?.code))throw error;
        if(attempt===2)throw Object.assign(Error('无法解析资源域名，自动重试仍未恢复；请检查链接或稍后重试',{cause:error}),{status:502,code:'CAPTURE_DNS_FAILED'});
        await pause(attempt===0?300:900,signal);
      }
    }
  };
}
export const resolveCaptureHost=createCaptureHostResolver();
