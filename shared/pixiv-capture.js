// A phone may resolve an authenticated Pixiv work locally. Only artwork
// metadata and public CDN URLs cross the capture queue, never account cookies.
const fail=message=>Object.assign(Error(message),{status:400});
export function pixivWork(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&/^(?:www\.)?pixiv\.net$/.test(u.hostname)?u.pathname.match(/^\/(?:[a-z]{2}\/)?artworks\/(\d{1,12})\/?$/)?.[1]||'':'';}catch{return '';}}
export function normalizePixivPost(raw,source){
 const id=pixivWork(source);if(!id||!raw||String(raw.work_id)!==id)throw fail('Pixiv 作品编号不匹配');
 if(Number(raw.type)===2)throw fail('Pixiv 动图请使用电脑 Pixiv 采集扩展，未将封面冒充动画');
 if(!Array.isArray(raw.images)||!raw.images.length||raw.images.length>200||raw.page_count!==raw.images.length)throw fail('Pixiv 未返回完整图集（最多 200 张）');
 const text=(v,max)=>typeof v==='string'?v.slice(0,max):'';
 const image=value=>{try{const u=new URL(value);if(u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&/(?:^|\.)pximg\.net$/.test(u.hostname)&&u.href.length<=4096)return u.href;}catch{}throw fail('Pixiv 图片地址无效');};
 return {work_id:id,page_count:raw.images.length,type:Number(raw.type)||0,title:text(raw.title,200),description:text(raw.description,16000),author:text(raw.author,80),tags:Array.isArray(raw.tags)?raw.tags.filter(t=>typeof t==='string').slice(0,25).map(t=>t.slice(0,40)):[],images:raw.images.map(row=>({original:image(row.original),...(row.preview?{preview:image(row.preview)}:{})}))};
}
export function pixivCapturePlan(raw,source){
 const post=normalizePixivPost(raw,source),candidates=post.images.map(i=>[...new Set([i.original,i.preview].filter(Boolean))]);
 return {kind:'note',default_image_mode:'group',url:'https://www.pixiv.net/artworks/'+post.work_id,title:post.title||'Pixiv 作品',content:post.description,author:post.author,tags:post.tags,images:candidates.map(row=>row[0]),image_candidates:candidates};
}
