import { unified } from 'unified';
import remarkParse from 'remark-parse';
const parser = unified().use(remarkParse);
export function markdownImages(content, includeLocal = false) {
  const tree = parser.parse(content), definitions = new Map(), images = [];
  const walk = (node, fn) => { fn(node); for (const child of node.children || []) walk(child,fn); };
  walk(tree,node=>{if(node.type==='definition') definitions.set(node.identifier,node);});
  walk(tree,node=>{
    const image=node.type==='image'?node:node.type==='imageReference'?definitions.get(node.identifier):null;
    if(image && (/^(https?:\/\/|data:image\/)/i.test(image.url) || (includeLocal && /^\/media\/[^/]+\/(original|thumbnail)(?:\?|$)/.test(image.url)))) images.push({url:image.url,alt:node.alt||'配图',title:image.title,
      start:node.position.start.offset,end:node.position.end.offset});
  });
  return images;
}
export function replaceMarkdownImages(content, images, replacements) {
  for(const image of [...images].sort((a,b)=>b.start-a.start)) {
    const url=replacements.get(image.url); if(!url) continue;
    const alt=image.alt.replace(/[\[\]\\\n]/g,' '), title=image.title?' "'+image.title.replace(/["\\]/g,'\\$&')+'"':'';
    content=content.slice(0,image.start)+`![${alt}](<${url}>${title})`+content.slice(image.end);
  }
  return content;
}

// Move complete image Markdown (including an enclosing image-only link), not
// adjacent text. Reference definitions stay where they are.
export function reorderLocalImages(content, ids) {
  const tree=parser.parse(content),definitions=new Map(),wanted=new Set(ids),slots=[];
  const collect=node=>{if(node.type==='definition')definitions.set(node.identifier,node);for(const child of node.children||[])collect(child);};collect(tree);
  const visit=node=>{
    const image=node.type==='link'&&node.children?.length===1?node.children[0]:node;
    const value=image.type==='image'?image:image.type==='imageReference'?definitions.get(image.identifier):null;
    const id=value?.url?.match(/^\/media\/([^/]+)\//)?.[1];
    if(wanted.has(id)){slots.push({id,start:node.position.start.offset,end:node.position.end.offset});return;}
    for(const child of node.children||[])visit(child);
  };visit(tree);
  if(ids.some(id=>!slots.some(slot=>slot.id===id)))throw Error('笔记配图已变化，请重新打开排序');
  const ordered=ids.flatMap(id=>slots.filter(slot=>slot.id===id).map(slot=>content.slice(slot.start,slot.end)));
  for(let i=slots.length-1;i>=0;i--)content=content.slice(0,slots[i].start)+ordered[i]+content.slice(slots[i].end);
  return content;
}
