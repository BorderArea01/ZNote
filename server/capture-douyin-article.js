const fail=message=>Object.assign(Error(message),{status:422});
export function douyinArticle(value){
  try{const url=new URL(value);return url.protocol==='https:'&&/^(?:www\.)?(?:douyin|iesdouyin)\.com$/.test(url.hostname)&&!url.username&&!url.password&&!url.port?url.pathname.match(/^\/article\/(\d+)\/?$/)?.[1]||'':'';}catch{return '';}
}
export function extractDouyinArticle(record,url){
  const article=record.article_info||record.articleInfo;if(!article)return null;
  const source=new URL(url),id=douyinArticle(url)||source.pathname.match(/\/(?:video|note|slides)\/(\d+)/)?.[1];
  const workId=String(record.aweme_id||record.awemeId||'');
  if(!id||workId!==id||String(article.article_id||article.articleId||'')!==id)throw fail('抖音文章编号不匹配，未保存其他作品');
  if(article.has_more===true||article.has_more===1)throw fail('抖音只提供了部分文章正文，请打开完整文章后重试');
  let data=article.article_content||article.articleContent;
  if(typeof data==='string'){if(data.length>2*1024*1024)throw fail('抖音文章数据过大');try{data=JSON.parse(data);}catch{throw fail('抖音文章正文格式无法读取');}}
  // The abstract/description is never a substitute for the complete article.
  const content=typeof data?.markdown==='string'?data.markdown.trim():'';
  if(!content)throw fail('抖音文章未提供完整正文，可能需要登录或验证');
  if(content.length>450000)throw fail('文章正文过长，未入库');
  return {kind:'note',capture_format:'douyin-article',default_image_mode:'note',url:'https://www.douyin.com/article/'+id,title:String(article.article_title||article.articleTitle||record.desc||'抖音文章').slice(0,200),content,author:record.author?.nickname||record.authorInfo?.nickname||''};
}
