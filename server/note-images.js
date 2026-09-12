import { markdownImages, replaceMarkdownImages } from '../shared/markdown-images.js';
export async function archiveNoteImages(input, { download, save }) {
  input={...input,content:input.content.replace(/\n\n<!-- znote-image-status -->[\s\S]*?<!-- \/znote-image-status -->/g,'')};
  const images=markdownImages(input.content), urls=[...new Set(images.map(i=>i.url))], replacements=new Map(), failures=[];
  let cursor=0, bytes=0; const started=Date.now();
  async function worker() {
    while(cursor<urls.length){
      const index=cursor++, url=urls[index];
      try {
        if(index>=200 || bytes>=500*1024*1024 || Date.now()-started>120000) throw Error('本次配图归档达到上限，请再次保存以继续');
        const buffer=await download(url);
        bytes+=buffer.length;
        if(buffer.length>25*1024*1024 || bytes>500*1024*1024) throw Error('配图容量超出上限');
        const item=await save({buffer,originalname:'正文配图'}, {title:`${input.title} · 配图 ${index+1}`.slice(0,200),
          content:'正文配图',tags:JSON.stringify(input.tags),collection_id:input.collection_id,
          source_url:input.source_url||null});
        replacements.set(url,item.url);
      } catch(e){failures.push({url:url.startsWith('data:')?'内嵌图片':url,error:e.message});}
    }
  }
  await Promise.all(Array.from({length:Math.min(3,urls.length)},worker));
  let content=replaceMarkdownImages(input.content,images,replacements);
  if(failures.length) {
    const detail=failures.slice(0,10).map(f=>`- ${f.error}：${f.url.slice(0,300)}`).join('\n');
    const notice=`\n\n<!-- znote-image-status -->\n配图归档提示：${failures.length} 张未归档，仍保留来源地址，可再次归档重试。\n${detail}\n<!-- /znote-image-status -->`;
    if(content.length+notice.length<490000)content+=notice;
  }
  return {content,report:{total:urls.length,archived:replacements.size,failures}};
}
