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
