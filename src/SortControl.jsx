import React, {useRef, useState, useEffect} from 'react';
import {createPortal} from 'react-dom';
import {ArrowUp, ArrowDown, SlidersHorizontal, X} from 'lucide-react';
import {HelpHint} from './HelpHint.jsx';
import {useAppBack} from './back-navigation.js';
import './sort-control.css';
export const DEFAULT_TYPE_ORDER='image,group,note,video';
const labels={image:'单张图片',group:'图片组',note:'图文笔记',video:'视频'};
export function SortControl({sort,setSort,direction,setDirection,grouped,setGrouped,order,setOrder}){
  const [open,setOpen]=useState(false),dialog=useRef(null),trigger=useRef(null);
  const close=()=>setOpen(false);
  useAppBack(close,open,210);
  useEffect(()=>{if(open){dialog.current.showModal();return()=>{dialog.current?.close();trigger.current?.focus();};}},[open]);
  const move=(at,step)=>{const next=order.split(',');[next[at],next[at+step]]=[next[at+step],next[at]];setOrder(next.join(','));};
  return <><button ref={trigger} className="sort-trigger" aria-haspopup="dialog" onClick={()=>setOpen(true)}><SlidersHorizontal size={16}/><span>排序{grouped?' · 类型分区':''}</span></button>{open&&createPortal(<dialog ref={dialog} className="sort-dialog" aria-labelledby="sort-title" onCancel={close} onClick={e=>{if(e.target===e.currentTarget){const r=e.currentTarget.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)close();}}}>
    <header><h2 id="sort-title">排序与分区</h2><button aria-label="关闭排序设置" onClick={close}><X size={18}/></button></header>
    <div className="sort-fields"><label>排序依据<select aria-label="排序方式" value={sort} onChange={e=>setSort(e.target.value)}><option value="updated">更新时间</option><option value="created">创建时间</option><option value="title">名称</option></select></label><label>区内顺序<select aria-label="排序方向" value={direction} onChange={e=>setDirection(e.target.value)}><option value="desc">{sort==='title'?'名称倒序':'最新在前'}</option><option value="asc">{sort==='title'?'名称正序':'最早在前'}</option></select></label></div>
    <div className="sort-group-toggle"><label><input type="checkbox" checked={grouped} onChange={e=>setGrouped(e.target.checked)}/>按类型分区</label><HelpHint label="排序">关闭时所有卡片统一排序。开启后，按下方类型顺序排列，每类内部再使用上面的排序设置。设置会按知识库保存。</HelpHint></div>
    {grouped&&<ol className="type-order">{order.split(',').map((type,i)=><li key={type}><span className="type-position">{i+1}</span><span>{labels[type]}</span><button aria-label={`${labels[type]}上移`} disabled={i===0} onClick={()=>move(i,-1)}><ArrowUp size={16}/></button><button aria-label={`${labels[type]}下移`} disabled={i===3} onClick={()=>move(i,1)}><ArrowDown size={16}/></button></li>)}</ol>}
    <footer><button className="text-button" onClick={()=>{setSort('updated');setDirection('desc');setGrouped(false);setOrder(DEFAULT_TYPE_ORDER);}}>恢复默认</button><button onClick={close}>完成</button></footer>
  </dialog>,document.body)}</>;
}
