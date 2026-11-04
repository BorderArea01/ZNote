import {parseHTML} from 'linkedom';
const fail=message=>Object.assign(Error(message),{status:422});
export const kuaishouHost=host=>/(^|\.)(?:kuaishou|chenzhongtech|gifshow)\.com$/i.test(host);
export function kuaishouWork(value){try{const u=new URL(value);if(!kuaishouHost(u.hostname)||u.username||u.password||u.port||!/^https?:$/.test(u.protocol))return '';return u.pathname.match(/^\/(?:short-video|long-video|fw\/(?:photo|long-video))\/([a-zA-Z0-9]+)\/?$/)?.[1]||'';}catch{return '';}}
const urls=value=>typeof value==='string'?[value]:Array.isArray(value)?value.flatMap(urls):value&&typeof value==='object'?urls(value.json??value.url):[];
function publicUrl(value){try{const u=new URL(value);return /^https?:$/.test(u.protocol)&&!u.username&&!u.password&&!u.port?u.href:'';}catch{return '';}}
function deref(value,store){const seen=new Set();for(let n=0;n<12&&value&&typeof value==='object';n++){const id=value.__ref||(value.type==='id'?value.id:null);if(!id||seen.has(id)||!Object.hasOwn(store,id))break;seen.add(id);value=store[id];}return value?.type==='json'?value.json:value;}
export function kuaishouRecord(photo,id,url,store={},author=''){
 photo=deref(photo,store);if(!photo||String(photo.id??photo.photoId??photo.photo_id)!==id)throw fail('快手返回的作品与请求不一致，未保存推荐内容');
 const candidates=[];
 const add=(value,priority=0)=>{for(const raw of urls(deref(value,store))){const link=publicUrl(raw);if(link&&!/\.m3u8(?:\?|$)/i.test(new URL(link).pathname))candidates.push({url:link,priority});}};
 const manifest=deref(photo.manifest,store);for(const set of manifest?.adaptationSet||[])for(const representation of deref(set,store)?.representation||[]){const rep=deref(representation,store);add(rep?.url,Number(rep?.height||0));add(rep?.backupUrl,Number(rep?.height||0)-.1);}
 for(const field of ['mainMvUrls','photoUrl','playUrl','videoUrl'])add(photo[field]);
 const video_urls=[...new Set(candidates.sort((a,b)=>b.priority-a.priority).map(v=>v.url))].slice(0,8);
 if(!video_urls.length)throw fail('快手未提供这条作品的可下载视频，可能需要登录验证；未把封面或空页面保存为成功');
 const caption=String(photo.caption||photo.description||'');
 return {kind:'video',url:'https://www.kuaishou.com/short-video/'+id,title:caption.split('\n')[0]||'快手视频',description:caption,content:caption,author:String(author||photo.userName||''),images:[],video_urls};
}
function stateJson(script,name){
 const match=new RegExp('(?:window\\.)?'+name+'\\s*=\\s*').exec(script);if(!match)return null;const raw=script.slice(match.index+match[0].length);let quoted=false,escaped=false,depth=0;
 for(let n=0;n<raw.length;n++){const ch=raw[n];if(quoted){if(escaped)escaped=false;else if(ch==='\\')escaped=true;else if(ch==='"')quoted=false;}else if(ch==='"')quoted=true;else if(ch==='{'||ch==='[')depth++;else if((ch==='}'||ch===']')&&--depth===0){try{return JSON.parse(raw.slice(0,n+1));}catch{return null;}}}return null;
}
export function extractKuaishouCapture(html,url){
 const id=kuaishouWork(url);if(!id)throw fail('请分享快手的具体作品链接');const{document}=parseHTML(html);
 for(const script of [...document.querySelectorAll('script:not([src])')].slice(0,150)){
  const state=stateJson(script.textContent,'__APOLLO_STATE__')||stateJson(script.textContent,'INIT_STATE');if(!state)continue;const store=state.defaultClient||state;
  const photo=store['VisionVideoDetailPhoto:'+id]||Object.values(store).find(value=>String(value?.id??value?.photo?.id??value?.photo?.photoId)!==''&&String(value?.id??value?.photo?.id??value?.photo?.photoId)===id);
  if(photo){const value=photo.photo||photo;return kuaishouRecord(value,id,url,store,photo.author?.name||'');}
 }
 throw fail('快手公开页面未提供这条作品的完整数据，可能需要登录或验证；未保存空页面');
}
const desktop='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
export async function fetchKuaishouPlan(value,signal,read,{progress}={}){
 let id=kuaishouWork(value);progress?.('正在读取快手作品');
 // Domestic share hosts are read directly, still using the existing DNS
 // validation/pinning at every redirect. Never change OS proxy or routing.
 if(!id){const resource=await read(value,signal,0,{direct:true});id=kuaishouWork(resource.url);if(!id)throw fail('快手分享链接未返回具体作品');}
 const canonical='https://www.kuaishou.com/short-video/'+id;
 const resource=await read(canonical,signal,0,{direct:true,userAgent:desktop});
 try{return {url:canonical,type:'text/html',buffer:resource.buffer,plan:extractKuaishouCapture(resource.buffer.toString('utf8'),canonical)};}catch(e){if(!/完整数据|未提供这条作品/.test(e.message))throw e;}
 // The desktop shell may only contain site configuration. Ask the public
 // detail endpoint for the exact ID, without importing another App's login.
 const query='query($photoId:String){visionVideoDetail(photoId:$photoId,page:"detail"){status author{name} photo{id caption photoUrl manifest{adaptationSet{representation{url backupUrl height}}}}}}';
 const response=await read('https://www.kuaishou.com/graphql',signal,0,{direct:true,json:true,accept:'application/json',contentType:'application/json',body:JSON.stringify({query,variables:{photoId:id}}),referer:canonical,userAgent:desktop});
 let data;try{data=JSON.parse(response.buffer);}catch{throw fail('快手作品接口返回了验证页面，未取得视频');}
 const detail=data.data?.visionVideoDetail;if(!detail?.photo)throw fail('快手未向公开接口提供这条视频，可能要求登录或平台验证；任务已保留，可从快手直接分享媒体文件');
 return {url:canonical,type:'text/html',buffer:resource.buffer,plan:kuaishouRecord(detail.photo,id,canonical,{},detail.author?.name)};
}
