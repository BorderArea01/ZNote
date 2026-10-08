const HOST=/^(?:www\.)?(?:e-hentai|exhentai)\.org$/i;
export const ehSite=value=>{try{return HOST.test(new URL(value).hostname);}catch{return false;}};

export function createEhPolicy({now=Date.now}={}){
  let blockedUntil=0;
  const error=()=>{
    const seconds=Math.max(1,Math.ceil((blockedUntil-now())/1000));
    return Object.assign(Error(`E-Hentai 当前出口 IP 因请求过快被临时封禁，约 ${Math.ceil(seconds/60)} 分钟后再试；已保存的图片保留，请勿反复重试`),{status:429,code:'EH_RATE_LIMIT',retry_after_seconds:seconds});
  };
  return {
    check(url){if(ehSite(url)&&blockedUntil>now())throw error();},
    response(url,buffer){
      if(!ehSite(url))return null;
      const text=buffer.toString('utf8',0,Math.min(buffer.length,16384)).replace(/<[^>]*>/g,' ').replace(/\s+/g,' ');
      if(!/This IP address has been temporarily banned due to an excessive request rate/i.test(text))return null;
      const expiry=text.match(/ban expires in (.{1,120})/i)?.[1]||'';
      const duration=[...expiry.matchAll(/(\d+)\s*(hours?|minutes?|seconds?)/gi)].reduce((sum,m)=>sum+Number(m[1])*(/^hour/i.test(m[2])?3600:/^minute/i.test(m[2])?60:1),0);
      // No expiry supplied: pause for five minutes, then allow a fresh check.
      blockedUntil=Math.max(blockedUntil,now()+Math.min(duration||300,86400)*1000);
      return error();
    },
  };
}
export const ehPolicy=createEhPolicy();
