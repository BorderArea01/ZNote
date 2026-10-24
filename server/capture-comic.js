import {parseHTML} from 'linkedom';

const fail=message=>Object.assign(Error(message),{status:422});
export function extractComicChapter(html,source){
  const url=new URL(source);
  if(/^(?:www\.)?mangapill\.com$/i.test(url.hostname)&&/^\/chapters\/\d+-\d+\/[^/]+\/?$/.test(url.pathname))return mangaPillChapter(html,url);
  if(!/^(?:www\.)?kxmh8\.(?:com|cc|top)$/i.test(url.hostname)||!/^\/comic\d+\/chapter\d+\.html$/.test(url.pathname))return null;
  const {document}=parseHTML(html),chapter=document.querySelector('.single');
  const pages=[...(chapter?.querySelectorAll('.font_max img.comic_img')||[])];
  if(!pages.length)throw fail('漫画章节尚未提供正文图片，请确认已打开章节阅读页');
  if(pages.length>200)throw fail('单章超过 200 页，请分段采集');
  // Keep DOM order and the complete signed URL; navigation and ads are excluded.
  const images=pages.map(img=>{
    try{
      const image=new URL(img.getAttribute('data-original')||img.getAttribute('data-src')||img.getAttribute('src')||'',url);
      return /^https?:$/.test(image.protocol)&&!image.username&&!image.password&&/\.(?:webp|jpe?g|png|gif|avif)$/i.test(image.pathname)?image.href:'';
    }catch{return '';}
  });
  if(images.some(url=>!url)||new Set(images).size!==pages.length)throw fail('漫画章节有缺失或重复的图片地址，未按不完整章节采集');
  const title=(chapter.querySelector('h1')?.textContent?.trim()||document.title||'漫画章节').slice(0,200);
  return {kind:'note',url:url.href,title,content:`章节：${title}`,images,image_candidates:images.map(url=>[url]),default_image_mode:'group'};
}

function mangaPillChapter(html,url){
  const {document}=parseHTML(html),pages=[...document.querySelectorAll('chapter-page')];
  if(!pages.length)throw fail('Mangapill 尚未提供完整章节图片，请打开章节阅读页后重试');
  if(pages.length>200)throw fail('单章超过 200 页，请分段采集');
  const images=pages.map((page,index)=>{
    // The page counter also lets us reject partially loaded chapters instead
    // of reporting success for the first visible page or a missing middle page.
    const counter=page.textContent.match(/\bpage\s+(\d+)\s*\/\s*(\d+)\b/i);
    if(!counter||Number(counter[1])!==index+1||Number(counter[2])!==pages.length)throw fail('Mangapill 章节页数不完整，未按缺页章节采集，请重试');
    const nodes=page.querySelectorAll('picture img.js-page');
    if(nodes.length!==1)throw fail('Mangapill 章节图片缺失，请重试');
    const img=nodes[0],value=img.getAttribute('data-src')||img.getAttribute('src')||'';
    try{
      const image=new URL(value,url);
      if(value&&/^https?:$/.test(image.protocol)&&!image.username&&!image.password&&/\.(?:jpe?g|webp|png|gif|avif)$/i.test(image.pathname))return image.href;
    }catch{}
    throw fail('Mangapill 章节原图地址无效，请重试');
  });
  if(new Set(images).size!==images.length)throw fail('Mangapill 章节图片重复，未按不完整章节采集');
  const title=(document.querySelector('h1')?.textContent?.trim()||document.title.replace(/\s*-\s*Mangapill\s*$/i,'')||'漫画章节').slice(0,200);
  return {kind:'note',url:url.href,title,content:`章节：${title}\n页数：${images.length}\n来源：${url.href}`,images,image_candidates:images.map(image=>[image]),default_image_mode:'group',parser:'mangapill-chapter-v1'};
}
