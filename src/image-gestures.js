const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const middle=(a,b)=>({x:(a.x+b.x)/2,y:(a.y+b.y)/2});
export const initialZoom=()=>({scale:1,x:0,y:0});
export function boundZoom(view,{width,height,imageWidth,imageHeight}) {
  const scale=clamp(view.scale,.25,8);
  const x=Math.max(0,(imageWidth*scale-width)/2),y=Math.max(0,(imageHeight*scale-height)/2);
  return {scale,x:x?clamp(view.x,-x,x):0,y:y?clamp(view.y,-y,y):0};
}
export function zoomAt(view,scale,point,bounds) {
  scale=clamp(scale,.25,8);const ratio=scale/view.scale;
  return boundZoom({scale,x:point.x-(point.x-view.x)*ratio,y:point.y-(point.y-view.y)*ratio},bounds);
}
// Rebase when the pointer count changes; lifting a finger must not cause a jump.
export class ZoomGesture {
  constructor(bounds){this.bounds=bounds;this.view=initialZoom();this.points=new Map();this.tap=null;this.base=null;}
  resize(bounds){this.bounds=bounds;this.cancel();this.view=boundZoom(this.view,bounds);return this.view;}
  cancel(){this.points.clear();this.base=null;this.tap=null;}
  set(view){this.cancel();this.view=boundZoom(view,this.bounds);return this.view;}
  rebase(){const p=[...this.points.values()];this.base=p.length>=2?{view:this.view,point:middle(p[0],p[1]),distance:Math.max(1,distance(p[0],p[1]))}:p.length?{view:this.view,point:p[0]}:null;}
  down(id,point,outside=false){this.points.set(id,point);if(this.points.size===1)this.tap={id,start:point,outside,moved:false};else this.tap=null;this.rebase();}
  move(id,point){
    if(!this.points.has(id))return this.view;
    this.points.set(id,point);if(this.tap&&distance(point,this.tap.start)>6)this.tap.moved=true;
    const p=[...this.points.values()],base=this.base;
    if(p.length>=2){const centre=middle(p[0],p[1]),scale=clamp(base.view.scale*distance(p[0],p[1])/base.distance,.25,8),ratio=scale/base.view.scale;
      this.view=boundZoom({scale,x:centre.x-(base.point.x-base.view.x)*ratio,y:centre.y-(base.point.y-base.view.y)*ratio},this.bounds);
    }else this.view=boundZoom({...base.view,x:base.view.x+point.x-base.point.x,y:base.view.y+point.y-base.point.y},this.bounds);
    return this.view;
  }
  up(id,point,outside=false,cancelled=false){
    if(!this.points.has(id))return false;
    if(!cancelled)this.move(id,point);
    const close=!cancelled&&this.points.size===1&&this.tap?.id===id&&this.tap.outside&&!this.tap.moved&&outside;
    this.points.delete(id);this.tap=null;this.rebase();return !!close;
  }
}
export class ImageSwipe {
  constructor(){this.points=new Set();this.start=null;this.suppressClick=false;this.tapped=false;}
  down(id,point,width){if(!this.points.size){this.suppressClick=false;this.start={id,point,width,moved:false,vertical:false};}this.points.add(id);if(this.points.size>1){this.start=null;this.suppressClick=true;}}
  move(id,point){if(!this.start||this.start.id!==id)return;const dx=Math.abs(point.x-this.start.point.x),dy=Math.abs(point.y-this.start.point.y);if(dx>10||dy>10){this.start.moved=true;this.suppressClick=true;if(dy>dx*1.2)this.start.vertical=true;}}
  up(id,point,cancelled=false){
    this.move(id,point);const start=this.start;this.points.delete(id);this.start=null;
    this.tapped=!cancelled&&!!start&&start.id===id&&!this.points.size&&!start.moved;
    if(cancelled){this.suppressClick=true;return 0;}
    if(!start||start.id!==id||this.points.size||start.vertical)return 0;
    const dx=point.x-start.point.x,dy=point.y-start.point.y,threshold=clamp(start.width*.15,40,90);
    return Math.abs(dx)>=threshold&&Math.abs(dx)>Math.abs(dy)*1.4?(dx<0?1:-1):0;
  }
  cancel(){this.points.clear();this.start=null;this.tapped=false;}
}
