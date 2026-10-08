import {parseHTML} from 'linkedom';

const fail=message=>Object.assign(Error(message),{status:422});
export function extractComicChapter(html,source){
  const url=new URL(source);
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
