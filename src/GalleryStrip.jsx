import React, { useState } from 'react';
export function GalleryStrip({items=[],index,onSelect,busy=false,required=false,expectedCount=0,error=''}) {
  const [hovered,setHovered]=useState(false),[pinned,setPinned]=useState(false);
  // A grouped video can spend a short time waiting for its order snapshot.
  // Keep the strip mounted during that window so the viewer does not look as
  // if the feature is missing. `required` is only used by grouped media;
  // single images/videos should still avoid a one-item strip.
  if(items.length<=1&&!required)return null;
  const expanded=hovered||pinned,start=Math.max(0,index-5),end=Math.min(items.length,index+6);
  // Auto-expansion must not move the thumbnail under a mouse that is already
  // down. Once a group is larger than the collapsed window, use the explicit
  // toggle so the current thumbnail keeps its coordinates while hovering.
  const hoverExpand=items.length<=11;
  const video=items.some(item=>item.kind==='video'),label=video?'视频':'图片',countLabel=video?'个视频':'张图片',itemLabel=video?'个视频':'张图片';
  const count = expectedCount > items.length ? `${items.length}/${expectedCount}` : items.length;
  const visible=expanded?items:items.slice(start,end),offset=expanded?0:start;
  const toggle=()=>{if(expanded){setHovered(false);setPinned(false);}else setPinned(true);};
  return <nav className={`gallery-strip${expanded?' is-expanded':''}`} aria-label={`${label}缩略图列`} onMouseEnter={()=>{if(hoverExpand)setHovered(true)}} onMouseLeave={()=>setHovered(false)} onFocus={event=>{if(hoverExpand&&!event.target.closest('.gallery-strip-toggle'))setHovered(true);}} onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget)&&!pinned)setHovered(false);}}>
    <div className="gallery-strip-toolbar">
      <span>组内预览 · {count} {countLabel}</span>
      <button className="gallery-strip-toggle" type="button" aria-expanded={expanded} disabled={busy} onClick={toggle}>{expanded?'收起预览':'展开全部'}</button>
    </div>
    <div className="gallery-strip-list" role="listbox" aria-label={`选择组内${label}`}>
      {!items.length && <span className="gallery-strip-status" role="status">{busy?'正在读取组内预览…':error||'暂时无法读取其他成员，请重试或刷新内容'}</span>}
      {!expanded&&start>0 && <button type="button" className="gallery-strip-jump" disabled={busy} onClick={()=>onSelect(Math.max(0,index-6))} aria-label={`更前面的${label}`}>…</button>}
      {visible.map((item,i)=>{const position=offset+i;return <button type="button" role="option" key={item.id||position} disabled={busy} aria-label={`查看第 ${position+1} ${itemLabel}`} aria-selected={position===index} aria-current={position===index?'true':undefined} onClick={()=>onSelect(position)}><img loading={expanded?'lazy':'eager'} decoding="async" src={item.thumbnail_url||item.url} alt=""/><span>{position+1}</span></button>})}
      {!expanded&&end<items.length && <button type="button" className="gallery-strip-jump" disabled={busy} onClick={()=>onSelect(Math.min(items.length-1,index+6))} aria-label={`更后面的${label}`}>…</button>}
    </div>
  </nav>;
}
