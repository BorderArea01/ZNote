import React from 'react';
export function GalleryStrip({items=[],index,onSelect,busy=false}) {
  const start=Math.max(0,index-5),end=Math.min(items.length,index+6);
  return items.length>1 && <nav className="gallery-strip" aria-label="图片缩略图列">
    {start>0 && <button disabled={busy} onClick={()=>onSelect(Math.max(0,index-6))} aria-label="更前面的图片">…</button>}
    {items.slice(start,end).map((item,i)=><button key={item.id||i+start} disabled={busy} aria-label={`查看第 ${i+start+1} 张`} aria-current={i+start===index?'true':undefined} onClick={()=>onSelect(i+start)}><img loading="lazy" src={item.thumbnail_url||item.url} alt=""/><span>{i+start+1}</span></button>)}
    {end<items.length && <button disabled={busy} onClick={()=>onSelect(Math.min(items.length-1,index+6))} aria-label="更后面的图片">…</button>}
  </nav>;
}
