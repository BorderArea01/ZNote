import {useEffect,useRef} from 'react';
import {ImageSwipe} from './image-gestures.js';
export function useImageSwipe({onSwipe,onTap,disabled,identity}) {
  const gesture=useRef(new ImageSwipe()),latest=useRef();latest.current={onSwipe,onTap,disabled};
  useEffect(()=>{gesture.current.cancel();},[identity,disabled]);
  const point=e=>({x:e.clientX,y:e.clientY});
  const end=(e,cancelled=false)=>{
    if(e.pointerType!=='touch')return;
    const model=gesture.current,step=model.up(e.pointerId,point(e),cancelled);
    // Own both touch actions so a delayed compatibility click cannot open the
    // next image after a swipe. Native mouse and keyboard clicks remain intact.
    model.suppressClick=true;
    if(!latest.current.disabled){if(step)latest.current.onSwipe(step);else if(model.tapped)latest.current.onTap();}
  };
  return {
    style:{touchAction:'pan-y pinch-zoom'},
    onPointerDown:e=>{if(e.pointerType!=='touch'){gesture.current.suppressClick=false;return;}gesture.current.down(e.pointerId,point(e),e.currentTarget.clientWidth);},
    onPointerMove:e=>{if(e.pointerType==='touch')gesture.current.move(e.pointerId,point(e));},
    onPointerUp:e=>end(e),onPointerCancel:e=>end(e,true),
    onLostPointerCapture:e=>{if(gesture.current.points.has(e.pointerId))end(e,true);},
    onClickCapture:e=>{if(gesture.current.suppressClick&&e.detail!==0){e.preventDefault();e.stopPropagation();}},
  };
}
