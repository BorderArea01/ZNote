import React,{useEffect,useRef,useState} from 'react';
import {X,RotateCcw,Minus,Plus} from 'lucide-react';
import {ZoomGesture,initialZoom,zoomAt} from './image-gestures.js';
import {useAppBack} from './back-navigation.js';
export function ZoomViewer({src,alt,onClose}) {
  useAppBack(()=>{onClose();},true,200);
  const root=useRef(),area=useRef(),picture=useRef(),frame=useRef(),closing=useRef(onClose);closing.current=onClose;
  const model=useRef(new ZoomGesture({width:1,height:1,imageWidth:0,imageHeight:0}));
  const [view,setView]=useState(initialZoom),[failed,setFailed]=useState(false),[attempt,setAttempt]=useState(0);
  const render=()=>{if(!frame.current)frame.current=requestAnimationFrame(()=>{frame.current=null;setView({...model.current.view});});};
  const point=e=>{const r=area.current.getBoundingClientRect();return{x:e.clientX-r.left-r.width/2,y:e.clientY-r.top-r.height/2};};
  const outside=e=>{const rect=picture.current?.getBoundingClientRect();return rect&&(e.clientX<rect.left||e.clientX>rect.right||e.clientY<rect.top||e.clientY>rect.bottom);};
  const measure=()=>{const el=area.current,img=picture.current;if(!el||!img)return;model.current.resize({width:Math.max(1,el.clientWidth-32),height:Math.max(1,el.clientHeight-120),imageWidth:img.clientWidth,imageHeight:img.clientHeight});render();};
  const reset=()=>{model.current.set(initialZoom());render();};
  const scaleBy=factor=>{const m=model.current;m.set(zoomAt(m.view,m.view.scale*factor,{x:0,y:0},m.bounds));render();};
  useEffect(()=>{setFailed(false);reset();},[src]);
  useEffect(()=>{
    const previous=document.activeElement,el=area.current;el.focus();
    const wheel=e=>{e.preventDefault();e.stopPropagation();const m=model.current;m.set(zoomAt(m.view,m.view.scale*Math.exp(-e.deltaY*.0015),point(e),m.bounds));render();};
    const escape=e=>{if(e.key==='Escape'&&!e.isComposing){e.preventDefault();e.stopPropagation();closing.current();}};
    const resize=new ResizeObserver(measure);resize.observe(el);measure();el.addEventListener('wheel',wheel,{passive:false});window.addEventListener('keydown',escape,true);
    return()=>{cancelAnimationFrame(frame.current);resize.disconnect();el.removeEventListener('wheel',wheel);window.removeEventListener('keydown',escape,true);model.current.cancel();if(previous?.isConnected)previous.focus({preventScroll:true});};
  },[]);
  const end=(e,cancelled=false)=>{const close=model.current.up(e.pointerId,point(e),outside(e),cancelled);render();if(close)onClose();};
  const keyboard=e=>{
    if(e.key==='Tab'){
      const targets=[...root.current.querySelectorAll('button,[tabindex="0"]')].filter(el=>!el.disabled&&el.offsetParent!==null),first=targets[0],last=targets.at(-1);
      if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}
    }
    if(e.ctrlKey||e.metaKey||e.altKey)return;
    if(['+','=','-','0'].includes(e.key)){e.preventDefault();e.stopPropagation();e.key==='0'?reset():scaleBy(e.key==='-'?1/1.25:1.25);}
  };
  return <div ref={root} className="lightbox zoom-viewer" role="dialog" aria-label="展开图片" aria-modal="true" onKeyDown={keyboard}>
    <div ref={area} className="zoom-surface" tabIndex={0} aria-label="图片缩放区域" onPointerDown={e=>{if(e.button!==0)return;model.current.down(e.pointerId,point(e),outside(e));try{e.currentTarget.setPointerCapture(e.pointerId);}catch{}}} onPointerMove={e=>{if(model.current.points.has(e.pointerId)){model.current.move(e.pointerId,point(e));render();}}} onPointerUp={e=>end(e)} onPointerCancel={e=>end(e,true)} onLostPointerCapture={e=>{if(model.current.points.has(e.pointerId))end(e,true);}} onDoubleClick={()=>model.current.view.scale>1?reset():scaleBy(2)}>
      <img ref={picture} key={src+':'+attempt} src={src} alt={alt} draggable={false} onLoad={()=>{setFailed(false);measure();}} onError={()=>setFailed(true)} style={{transform:`translate(${view.x}px,${view.y}px) scale(${view.scale})`}}/>
    </div>
    {failed&&<div className="zoom-error" role="alert">图片加载失败<button onClick={()=>{setFailed(false);setAttempt(n=>n+1);}}>重试图片</button></div>}
    <button className="zoom-close" aria-label="退出全屏" onClick={onClose}><X size={22}/></button>
    <div className="zoom-tools"><button aria-label="缩小" onClick={()=>scaleBy(1/1.25)}><Minus size={18}/></button><output aria-label="缩放比例">{Math.round(view.scale*100)}%</output><button aria-label="放大" onClick={()=>scaleBy(1.25)}><Plus size={18}/></button><button aria-label="重置缩放" title="双指或滚轮缩放，拖动平移，双击放大 / 复位；+ / − 缩放，0 复位" onClick={reset}><RotateCcw size={18}/></button></div>
  </div>;
}
