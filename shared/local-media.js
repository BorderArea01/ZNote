import {unified} from 'unified';
import remarkParse from 'remark-parse';
const parser=unified().use(remarkParse);
export function localMediaReferences(content) {
  const found=[];
  const walk=node=>{
    const match=node.url?.match(/^\/media\/([^/]+)\/(original|thumbnail)(?:[?#]|$)/);
    if(match){
      const start=node.position.start.offset,raw=content.slice(start,node.position.end.offset);
      let prefix=0;
      if(node.type==='link'&&node.children?.length){prefix=node.children.at(-1).position.end.offset-start+2;}
      else if(raw.startsWith('[')||raw.startsWith('![')){
        let depth=0;
        for(let i=raw.startsWith('!')?1:0;i<raw.length;i++){
          if(raw[i]==='\\'){i++;continue}
          if(raw[i]==='[')depth++;
          if(raw[i]===']'&&--depth===0){prefix=i+2;break}
        }
      }
      const localPath=`/media/${match[1]}/`;
      const index=raw.indexOf(localPath,Math.max(0,prefix===1?0:prefix));
      found.push({id:match[1],url:node.url,start:index<0?null:start+index+7,end:index<0?null:start+index+7+match[1].length});
    }
    for(const child of node.children||[])walk(child);
  };walk(parser.parse(content));return found;
}
export function replaceLocalMedia(content,references,replacements) {
  if(references.some(ref=>ref.start===null&&replacements.has(ref.id)))throw Object.assign(Error('无法定位配图的 Markdown 地址，请先使用标准图片链接格式'),{status:409});
  for(const ref of [...references].sort((a,b)=>b.start-a.start)){const id=replacements.get(ref.id);if(id)content=content.slice(0,ref.start)+id+content.slice(ref.end)}return content;
}
