import {parseHTML} from 'linkedom';
import {MAX_CAPTURE_GROUP_IMAGES} from '../shared/capture-limits.js';
const fail=message=>Object.assign(Error(message),{status:422});
export function zeriComic(value){
  const u=new URL(value);
  if(!/^(?:www\.)?zeri-m\.monster$/i.test(u.hostname)||u.pathname!=='/index.php'||u.searchParams.get('route')!=='comic/article')return null;
  const id=u.searchParams.get('comic_id'),cid=u.searchParams.get('c_id');
  if(!/^[1-9]\d{0,11}$/.test(id||'')||!/^[a-f\d]{32}$/i.test(cid||'')||u.searchParams.getAll('comic_id').length!==1||u.searchParams.getAll('c_id').length!==1||u.searchParams.getAll('route').length!==1)throw fail('作品链接编号不完整或重复，请复制完整详情页链接');
  return {url:u,id,cid};
}
// Read JSON literals only. Never execute the site's advertising/player code.
function assignment(document,name){
  const pattern=new RegExp('(?:^|[;\\r\\n])\\s*(?:(?:var|let|const)\\s+)?'+name+'\\s*=\\s*','g');
  for(const script of document.querySelectorAll('script:not([src])')){
    const text=script.textContent;pattern.lastIndex=0;let match;
    while((match=pattern.exec(text))){
      const raw=text.slice(pattern.lastIndex);let depth=0,quoted=false,escaped=false;
      for(let i=0;i<raw.length;i++){
        const c=raw[i];
        if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;}
        else if(c==='"')quoted=true;else if(c==='{'||c==='[')depth++;else if(c==='}'||c===']')depth--;
        if(!quoted&&depth===0&&(c===';'||c==='\n'||c==='\r'||i===raw.length-1)){
          try{return JSON.parse(raw.slice(0,c===';'||c==='\n'||c==='\r'?i:i+1).trim());}catch{break;}
        }
      }
    }
  }
  throw fail('作品阅读数据不完整，可能需要登录或验证；未保存封面或推荐图片');
}
function pageList(value){
  if(!Array.isArray(value)||!value.length||value.length>MAX_CAPTURE_GROUP_IMAGES)throw fail('作品图片清单缺失或超过采集上限');
  return value.map((item,index)=>{
    if(!item||String(item.sort)!==String(index+1)||item.is_deleted==='1')throw fail('作品页序缺失或重复，未按缺页图组采集');
    const ext=String(item.extension||'').toLowerCase();if(!/^(?:jpg|jpeg|png|gif|webp|avif)$/.test(ext))throw fail('作品图片格式无效');
    return {sort:String(item.sort),extension:['gif','webp','avif'].includes(ext)?ext:'jpg'};
  });
}
export function zeriArticle(html,source){
  const identity=zeriComic(source);if(!identity)return null;
  const {document}=parseHTML(html),data=assignment(document,'comic_data');
  if(!data||typeof data!=='object'||Array.isArray(data)||String(data.comic_id)!==identity.id||data.c_id!==identity.cid||String(data.is_deleted)==='1')throw fail('页面作品编号与分享链接不一致，未采集其他作品');
  if(typeof data.gk_id!=='string'||!data.gk_id||data.gk_id.length>4096)throw fail('作品阅读入口不完整，可能需要登录或验证');
  const pages=pageList(data.imgs);
  const readers=[...document.querySelectorAll('a[href]')].flatMap(a=>{try{const u=new URL(a.getAttribute('href'),identity.url);return u.origin===identity.url.origin&&u.pathname==='/index.php'&&u.searchParams.get('route')==='comic/reader'&&u.searchParams.get('c_id')===identity.cid&&u.searchParams.get('gk_id')===data.gk_id?[u.href]:[];}catch{return[];}});
  if(!readers.length)throw fail('作品未提供当前作品的阅读入口，未按不完整预览采集');
  const title=String(data.title||document.querySelector('h1')?.textContent||document.title||'漫画作品').trim().slice(0,200);
  return {...identity,pages,title,reader:readers[0],galleryId:String(data.exhentai_id||'')};
}
export function extractZeriReader(html,article){
  const {document}=parseHTML(html);
  if(String(assignment(document,'postID'))!==article.id||assignment(document,'c_id')!==article.cid)throw fail('阅读页作品编号不一致，未采集其他作品');
  const pages=pageList(assignment(document,'Image_List'));
  if(JSON.stringify(pages)!==JSON.stringify(article.pages))throw fail('作品阅读页与详情清单不一致，未按缺页图组采集');
  const folder=assignment(document,'IMAGE_FOLDER'),server=assignment(document,'IMAGE_SERVER'),serverId=String(assignment(document,'image_server_id'));
  if(typeof folder!=='string'||folder.length>200||!/^(?:[a-zA-Z0-9_-]+\/)+$/.test(folder)||!/^\d+$/.test(article.galleryId)||!folder.endsWith('/'+article.galleryId+'/'))throw fail('作品图片目录无效');
  const bases=server?.[serverId];if(!Array.isArray(bases)||!bases.length||bases.length>10)throw fail('作品图片线路缺失');
  const addresses=bases.map(value=>{try{const u=new URL(value,article.url);if(!/^https?:$/.test(u.protocol)||u.username||u.password||u.port||u.search||u.hash||u.pathname!=='/image/'||!u.hostname.includes('.')||u.hostname.includes(':')||/^\d+(?:\.\d+){3}$/.test(u.hostname)||/(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(u.hostname))throw Error();return u.href;}catch{throw fail('作品图片线路不是有效公开地址');}});
  const image_candidates=pages.map((page,index)=>[...new Set([addresses[index%addresses.length],...addresses])].map(base=>base+folder+page.sort+'.'+page.extension));
  const source=article.url.href;
  return {kind:'note',url:source,title:article.title,content:[`作品：${article.title}`,`页数：${pages.length}`,`来源：${source}`,folder.startsWith('thumbnail/')?'图片版本：站点提供的阅读图片（未放大）':''].filter(Boolean).join('\n'),images:image_candidates.map(v=>v[0]),image_candidates,default_image_mode:'group',parser:'zeri-chapter-v1'};
}
export async function fetchZeriChapter(source,signal,{fetchDocument,progress}={}){
  const identity=zeriComic(source);if(!identity)return null;
  progress?.('正在读取作品图片清单');
  const resource=await fetchDocument(source,signal);signal.throwIfAborted();
  if(new URL(resource.url).origin!==identity.url.origin||zeriComic(resource.url)?.id!==identity.id)throw fail('作品跳转到了其他页面，可能需要登录或验证');
  const article=zeriArticle(resource.buffer.toString('utf8'),source);
  progress?.(`正在读取完整阅读页 · ${article.pages.length} 张`);
  const reader=await fetchDocument(article.reader,signal,0,{referer:source});signal.throwIfAborted();
  if(new URL(reader.url).origin!==identity.url.origin||new URL(reader.url).searchParams.get('route')!=='comic/reader')throw fail('阅读入口跳转异常，未采集其他作品');
  return {...resource,plan:extractZeriReader(reader.buffer.toString('utf8'),article)};
}
