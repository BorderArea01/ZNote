import React,{useEffect,useRef,useState} from 'react';
import {X,RotateCcw,Minus,Plus} from 'lucide-react';
export function ZoomViewer({src,alt,onClose}) {
  const area=useRef(), drag=useRef(), [view,setView]=useState({scale:1,x:0,y:0});
  useEffect(()=>{const previous=document.activeElement,el=area.current;el.focus();const wheel=e=>{e.preventDefault();e.stopPropagation();const r=el.getBoundingClientRect(),x=e.clientX-r.left-r.width/2,y=e.clientY-r.top-r.height/2;setView(v=>{const scale=Math.max(.25,Math.min(8,v.scale*Math.exp(-e.deltaY*.0015))),ratio=scale/v.scale;return{scale,x:x-(x-v.x)*ratio,y:y-(y-v.y)*ratio}})};el.addEventListener('wheel',wheel,{passive:false});return()=>{el.removeEventListener('wheel',wheel);if(previous?.isConnected)previous.focus()}},[]);
  return <div className="lightbox zoom-viewer" role="dialog" aria-label="展开图片" aria-modal="true" onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();onClose()}}}>
    <div ref={area} className="zoom-surface" tabIndex={0} onPointerDown={e=>{if(e.button!==0)return;drag.current={px:e.clientX,py:e.clientY,x:view.x,y:view.y};e.currentTarget.setPointerCapture(e.pointerId)}} onPointerMove={e=>{if(drag.current)setView(v=>({...v,x:drag.current.x+e.clientX-drag.current.px,y:drag.current.y+e.clientY-drag.current.py}))}} onPointerUp={()=>drag.current=null} onPointerCancel={()=>drag.current=null} onDoubleClick={()=>setView({scale:1,x:0,y:0})}>
      <img src={src} alt={alt} draggable={false} style={{transform:`translate(${view.x}px,${view.y}px) scale(${view.scale})`}}/>
    </div>
    <button className="zoom-close" aria-label="退出全屏" onClick={onClose}><X size={22}/></button>
    <div className="zoom-tools"><button aria-label="缩小" onClick={()=>setView(v=>({...v,scale:Math.max(.25,v.scale/1.25)}))}><Minus size={18}/></button><output aria-label="缩放比例">{Math.round(view.scale*100)}%</output><button aria-label="放大" onClick={()=>setView(v=>({...v,scale:Math.min(8,v.scale*1.25)}))}><Plus size={18}/></button><button aria-label="重置缩放" title="滚轮缩放，拖动平移，双击复位" onClick={()=>setView({scale:1,x:0,y:0})}><RotateCcw size={18}/></button></div>
  </div>;
}
