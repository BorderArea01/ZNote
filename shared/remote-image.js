// Link-only image capture: never send file bytes, cookies or arbitrary headers.
function publicUrl(value){
  if(typeof value!=='string'||value.length>4096)throw Error('图片地址过长或无效');
  const u=new URL(value),h=u.hostname;
  if(!/^https?:$/.test(u.protocol)||u.username||u.password||u.port||!h.includes('.')||h.includes(':')||/^\d+(?:\.\d+){3}$/.test(h)||/(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(h))throw Error('远程图片只支持公开 HTTP(S) 地址，不支持本机、内网、blob 或截图');
  return u.href;
}
export function normalizeRemoteImage(raw){
  if(!raw||!Array.isArray(raw.urls)||!raw.urls.length||raw.urls.length>8)throw Error('图片候选地址无效');
  const urls=[...new Set(raw.urls.map(publicUrl))],source_url=publicUrl(raw.source_url);
  if(raw.title!==undefined&&(typeof raw.title!=='string'||raw.title.length>200))throw Error('图片标题无效');
  return {urls,source_url,title:raw.title?.trim()||'网页图片'};
}
