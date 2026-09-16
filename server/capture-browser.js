import {extractCapturePage} from './capture-page.js';
const fail=message=>Object.assign(Error(message),{status:422});
const domains=['douyin.com','iesdouyin.com','douyinstatic.com','douyincdn.com','douyinpic.com','douyinvod.com','byteimg.com','bytedance.com','bytednsdoc.com','bytescm.com','bytegoofy.com','ibytedtos.com','pstatp.com','snssdk.com','bytecdn.cn','bytetos.com'];
export function allowedCaptureRequest(value,type){
  try{const u=new URL(value);return /^https?:$/.test(u.protocol)&&!u.username&&!u.password&&!u.port&&!['image','media','font'].includes(type)&&domains.some(d=>u.hostname===d||u.hostname.endsWith('.'+d));}catch{return false;}
}
export function douyinWork(value){
  try{const u=new URL(value);if(!/(^|\.)(douyin|iesdouyin)\.com$/.test(u.hostname))return '';return u.pathname.match(/\/(?:video|note|slides)\/(\d+)/)?.[1]||(/^\d+$/.test(u.searchParams.get('modal_id')||'')?u.searchParams.get('modal_id'):'');}catch{return '';}
}
// One short-lived anonymous browser, never a user's profile or a resident browser.
// Only the requested work's detail response is used; recommendations are ignored.
export async function renderDouyinCapture(source,signal){
  const id=douyinWork(source);if(!id)throw fail('请分享抖音的具体作品链接');
  signal.throwIfAborted();let browser,timer;let closed=false;
  const close=()=>{closed=true;browser?.close().catch(()=>{});};
  signal.addEventListener('abort',close,{once:true});timer=setTimeout(close,30000);
  try{
    const {chromium}=await import('playwright-core');
    const options={headless:true,timeout:10000,args:['--disable-background-networking','--disable-component-update','--force-webrtc-ip-handling-policy=disable_non_proxied_udp']};
    if(process.env.ZNOTE_CAPTURE_BROWSER)browser=await chromium.launch({...options,executablePath:process.env.ZNOTE_CAPTURE_BROWSER});
    else {for(const channel of ['msedge','chrome',undefined]){try{browser=await chromium.launch({...options,...(channel?{channel}:{})});break;}catch{if(closed)break;}}}
    if(!browser)throw fail('抖音需要网页解析组件：请在服务器安装 Edge / Chrome，或配置 ZNOTE_CAPTURE_BROWSER');
    if(closed){signal.throwIfAborted();throw fail('抖音页面解析超时，可重试');}
    const context=await browser.newContext({serviceWorkers:'block',acceptDownloads:false,viewport:{width:1280,height:800}});
    let count=0;
    await context.route('**/*',route=>{const r=route.request();return (++count>250||!allowedCaptureRequest(r.url(),r.resourceType())?route.abort():route.continue()).catch(()=>{});});
    const page=await context.newPage();context.on('page',p=>{if(p!==page)p.close().catch(()=>{});});
    let plan,filterReason;
    page.on('response',async response=>{
      try{
        const u=new URL(response.url());if(!/(^|\.)(?:douyin|iesdouyin)\.com$/.test(u.hostname)||!(/\/aweme\/detail(?:\/|$)/.test(u.pathname)||/\/aweme\/slidesinfo(?:\/|$)/.test(u.pathname))||response.status()!==200||Number(response.headers()['content-length'])>2*1024*1024)return;
        const body=await response.body();if(body.length>2*1024*1024)return;
        const data=JSON.parse(body.toString()),record=data.aweme_detail||data.aweme_details?.find(v=>String(v?.aweme_id)===id)||data.data?.ItemInfoList?.find(v=>String(v?.aweme_id)===id);
        const filtered=data.filter_list?.find(v=>String(v?.aweme_id)===id);if(filtered)filterReason=filtered.reason;
        if(String(record?.aweme_id)!==id)return;
        const json=JSON.stringify(record).replace(/</g,'\\u003c');
        plan=extractCapturePage(`<script type="application/json">${json}</script>`,source);
      }catch{}
    });
    const requested=new URL(source),gallery=/\/(?:note|slides)\//.test(requested.pathname);
    const targets=gallery?[`https://www.iesdouyin.com/share/slides/${id}/`,source]:[source,`https://www.douyin.com/video/${id}`];
    for(const target of [...new Set(targets)]){
      try{await page.goto(target,{waitUntil:'domcontentloaded',timeout:18000});}catch(e){if(closed)throw e;}
      for(let waited=0;!closed&&!plan&&waited<67;waited++)await page.waitForTimeout(150);
      if(plan)break;
    }
    signal.throwIfAborted();
    if(!plan&&filterReason!==undefined)throw fail(`抖音未向公开分享页提供这条作品的原始资源（平台限制 ${filterReason}）；任务已保留，可稍后重试或把媒体文件直接分享给 ZNote`);
    if(!plan||!(plan.images?.length||plan.video_urls?.length))throw fail('抖音未向匿名公开页面提供这条作品的完整资源，可能要求登录验证或作品已不可访问；任务已保留，可稍后重试或把媒体文件直接分享给 ZNote');
    return plan;
  }catch(e){signal.throwIfAborted();if(e.status)throw e;throw fail('抖音网页解析未完成，可能超时或需要平台验证；任务已保留，可重试');}
  finally{clearTimeout(timer);signal.removeEventListener('abort',close);await browser?.close().catch(()=>{});}
}
