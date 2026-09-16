const clean=(value,max)=>typeof value==='string'?value.replace(/[\x00-\x1f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max):'';
export function videoDetails(metadata={},tags=[]) {
  const author=clean(metadata.author,200),title=clean(metadata.title,200)||'网页视频';
  let authorUrl='';try{const url=new URL(metadata.author_url);if(/^https?:$/.test(url.protocol)&&!url.username&&!url.password&&url.href.length<4096)authorUrl=url.href}catch{}
  const label=author.replace(/[\\[\]<>*_`]/g,'\\$&');
  return {title,tags:[...new Set([...(author?[author.slice(0,40)]:[]),...tags])],content:author?`作者：${authorUrl?'['+label+'](<'+authorUrl.replaceAll('>','%3E')+'>)':label}`:''};
}
