// Site adapters read only the selected work, never creator-wide recommendations.
export async function siteArticle(document, location, fetcher = fetch) {
  const host=location.hostname.replace(/^www\./,'');
  if(host==='pixiv.net') {
    const id=location.pathname.match(/^\/(?:[a-z]{2}\/)?artworks\/(\d+)\/?$/)?.[1];
    if(!id) throw Error('请打开 Pixiv 单个作品详情页后采集正文');
    async function json(path){
      const response=await fetcher(new URL(path,location.origin),{credentials:'include',redirect:'error',signal:AbortSignal.timeout(15000)});
      if(!response.ok)throw Error(`Pixiv 作品读取失败 HTTP ${response.status}，请确认已登录并能打开该作品`);
      const text=await response.text();if(text.length>5*1024*1024)throw Error('Pixiv 作品数据过大');
      let data;try{data=JSON.parse(text);}catch{throw Error('Pixiv 返回了验证页面，请先在原网页完成验证');}
      if(data.error || !data.body)throw Error(data.message||'Pixiv 作品不可访问');return data.body;
    }
    const [info,pages]=await Promise.all([json(`/ajax/illust/${id}`),json(`/ajax/illust/${id}/pages`)]);
    if(!Array.isArray(pages)||!pages.length||pages.length>200)throw Error('该作品页数超出本次支持范围（1～200 张）');
    if(Number(info.pageCount)>pages.length)throw Error('Pixiv 未返回全部作品页，请稍后重试');
    const clone=document.implementation.createHTMLDocument(info.title||document.title), article=clone.createElement('article');
    const heading=clone.createElement('h1');heading.textContent=info.title||document.title;article.append(heading);
    const author=clone.createElement('p');author.textContent=`作者：${info.userName||info.userId||'未知'}`;article.append(author);
    const description=clone.createElement('div');description.innerHTML=info.description||'';article.append(description);
    if(info.illustType===2){const note=clone.createElement('p');note.textContent='此作品为动图，本笔记归档的是静态预览图，不包含动画帧。';article.append(note);}
    for(const [index,page] of pages.entries()) {
      const url=new URL(page.urls?.original||'');
      if(url.protocol!=='https:'||!/(^|\.)pximg\.net$/.test(url.hostname))throw Error('Pixiv 原图地址无法识别');
      const img=clone.createElement('img');img.src=url.href;img.alt=`第 ${index+1} 张`;img.setAttribute('data-znote-work-image','');article.append(img);
    }
    clone.body.append(article);return {document:clone,title:info.title,byline:info.userName||'',selector:'article'};
  }
  if(['pawchive.pw','pawchive.st'].includes(host)) {
    if(!/^\/(?:fanbox|patreon)\/user\/[^/]+\/post\/[^/]+\/?$/.test(location.pathname))throw Error('请打开 Pawchive 单篇作品页后采集正文');
    const main=document.querySelector('main');if(!main)throw Error('Pawchive 正文尚未加载，请先打开作品');
    // PawPreviewer uses main figure links / fileThumb anchors for original files.
    const clone=document.implementation.createHTMLDocument(document.title), article=main.cloneNode(true);
    article.querySelectorAll('nav,aside,.post-card--preview,.post__comments,.post__recommendations,[data-znote-overlay]').forEach(el=>el.remove());
    const isOriginal=value=>{
      try{const url=new URL(value,location.href);return /^https?:$/.test(url.protocol)&&/^file\.pawchive\.(pw|st)$/.test(url.hostname)&&/\.(avif|bmp|gif|jpe?g|png|webp)$/i.test(url.searchParams.get('f')||url.pathname);}catch{return false;}
    };
    const seen=new Set();
    for(const link of article.querySelectorAll('figure a[href],a.fileThumb[href]')){
      const url=new URL(link.getAttribute('href'),location.href).href;if(!isOriginal(url))continue;
      if(seen.has(url)){link.remove();continue;} seen.add(url);
      const img=clone.createElement('img');img.src=url;img.alt=link.querySelector('img')?.alt||`作品配图 ${seen.size}`;img.setAttribute('data-znote-work-image','');link.replaceWith(img);
    }
    for(const image of article.querySelectorAll('img')) if(!seen.has(image.getAttribute('src'))&&!image.closest('.post__content'))image.remove();
    if(!seen.size && !article.querySelector('.post__content'))throw Error('未找到作品正文或原图，请确认已登录且作品加载完成');
    clone.body.append(article);return {document:clone,title:main.querySelector('h1')?.textContent?.trim()||document.title,selector:'main'};
  }
  return null;
}
