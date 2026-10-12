import {parseHTML} from 'linkedom';
import {MAX_CAPTURE_GROUP_IMAGES} from '../shared/capture-limits.js';
const fail=message=>Object.assign(Error(message),{status:422});
export function jlijiSet(source){const u=new URL(source);return /^(?:www\.)?jliji\.com$/i.test(u.hostname)&&/^\/set\/\d+\/?$/.test(u.pathname);}
export function extractJlijiGallery(html,source){
  if(!jlijiSet(source))return null;
  const url=new URL(source),id=url.pathname.match(/\d+/)[0],{document}=parseHTML(html);
  const gallery=document.querySelector('.set-detail-page .gallery-grid');
  const rows=[...(gallery?.querySelectorAll('.gallery-item img[data-set-id]')||[])].filter(row=>row.getAttribute('data-set-id')===id);
  if(!rows.length)throw fail('图集尚未提供原图列表，请确认作品页已加载');
  if(rows.length>MAX_CAPTURE_GROUP_IMAGES)throw fail(`单次图片组最多 ${MAX_CAPTURE_GROUP_IMAGES} 张`);
  const images=rows.map(row=>{
    try{const raw=row.getAttribute('data-full');if(!raw)return '';const image=new URL(raw,url);return /^https?:$/.test(image.protocol)&&!image.username&&!image.password?image.href:'';}catch{return '';}
  });
  if(images.some(image=>!image)||new Set(images).size!==rows.length)throw fail('图集原图列表缺失或重复，未使用缩略图代替');
  const header=document.querySelector('.set-detail-header'),title=(header?.querySelector('h1')?.textContent.trim()||document.title||'网页图集').slice(0,200);
  const count=header?.querySelector('.set-detail-meta')?.textContent.match(/(\d+)\s*\/\s*(\d+)\s*张图片/);
  if(count&&(Number(count[1])!==images.length||Number(count[2])!==images.length))throw fail('网页只提供部分图集，未按完整图集保存');
  const metadata=[...(header?.querySelectorAll('.set-category-link')||[])].map(row=>row.textContent.trim()).filter(Boolean);
  return {kind:'note',url:url.href,title,content:[title,...metadata].join('\n'),images,image_candidates:images.map(image=>[image]),default_image_mode:'group',parser:'jliji-gallery-v1'};
}
