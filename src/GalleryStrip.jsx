import React, { useState } from 'react';
export function GalleryStrip({items=[],index,onSelect,busy=false}) {
  const [hovered,setHovered]=useState(false),[pinned,setPinned]=useState(false);
  if(items.length<=1)return null;
  const expanded=hovered||pinned,start=Math.max(0,index-5),end=Math.min(items.length,index+6);
  const video=items.some(item=>item.kind==='video'),label=video?'视频':'图片',countLabel=video?'个视频':'张图片',itemLabel=video?'个视频':'张图片';
  const visible=expanded?items:items.slice(start,end),offset=expanded?0:start;
  return <nav className={`gallery-strip${expanded?' is-expanded':''}`} aria-label={`${label}缩略图列`} onMouseEnter={()=>setHovered(true)} onMouseLeave={()=>setHovered(false)} onFocus={()=>setHovered(true)}>
    <div className="gallery-strip-toolbar">
      <span>组内预览 · {items.length} {countLabel}</span>
      <button className="gallery-strip-toggle" type="button" aria-expanded={expanded} disabled={busy} onClick={()=>setPinned(value=>!value)}>{expanded?'收起预览':'展开全部'}</button>
    </div>
    <div className="gallery-strip-list" role="listbox" aria-label={`选择组内${label}`}>
      {!expanded&&start>0 && <button type="button" className="gallery-strip-jump" disabled={busy} onClick={()=>onSelect(Math.max(0,index-6))} aria-label={`更前面的${label}`}>…</button>}
      {visible.map((item,i)=>{const position=offset+i;return <button type="button" role="option" key={item.id||position} disabled={busy} aria-label={`查看第 ${position+1} ${itemLabel}`} aria-selected={position===index} aria-current={position===index?'true':undefined} onClick={()=>onSelect(position)}><img loading="lazy" src={item.thumbnail_url||item.url} alt=""/><span>{position+1}</span></button>})}
      {!expanded&&end<items.length && <button type="button" className="gallery-strip-jump" disabled={busy} onClick={()=>onSelect(Math.min(items.length-1,index+6))} aria-label={`更后面的${label}`}>…</button>}
    </div>
  </nav>;
}
