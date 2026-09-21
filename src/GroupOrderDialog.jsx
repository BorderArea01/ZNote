import React, {useCallback, useEffect, useRef, useState} from 'react';
import {ArrowLeft, ArrowRight, GripVertical} from 'lucide-react';
import {Dialog} from './ui.jsx';
import {api, send} from './api.js';

export function GroupOrderDialog({id,kind='image',onClose,onDone}) {
  const [snapshot,setSnapshot]=useState(null),[items,setItems]=useState([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[sync,setSync]=useState(true),[page,setPage]=useState(0),[drag,setDrag]=useState(null);
  const pointer=useRef(null),pageSize=60;
  const mediaKind=snapshot?.kind||kind;
  const mediaLabel=mediaKind==='video'?'视频':'图片';
  const load=useCallback(()=>{let active=true;setSnapshot(null);setItems([]);setError('');setPage(0);api('/api/item-groups/order?id='+encodeURIComponent(id)).then(value=>{if(active){setSnapshot(value);setItems(value.items)}}).catch(e=>active&&setError(e.message));return()=>{active=false}},[id]);
  useEffect(()=>load(),[load]);
  const displayError=mediaKind==='video'&&/图片组/.test(error)?error.replaceAll('图片组','视频组'):error;
  const dirty=!!snapshot&&items.some((item,i)=>item.id!==snapshot.items[i]?.id);
  const close=()=>{if(!busy&&(!dirty||confirm('排序尚未保存，确定关闭吗？')))onClose()};
  function move(fromId,toId){if(busy||fromId===toId)return;setItems(old=>{const next=[...old],from=next.findIndex(i=>i.id===fromId),to=next.findIndex(i=>i.id===toId);if(from<0||to<0)return old;next.splice(to,0,next.splice(from,1)[0]);return next})}
  async function save(){setBusy(true);setError('');try{const result=await send('/api/item-groups/order',{id,revision:snapshot.revision,ids:items.map(i=>i.id),sync_note:sync,undo:true});onDone(result);onClose()}catch(e){setError(e.message)}finally{setBusy(false)}}
  return <Dialog title={`调整${mediaLabel}顺序`} className="group-order-dialog" onClose={close}>
    <div className="order-summary"><span>拖动排序 · 首个{mediaLabel}为封面</span><span>{items.length} 个{mediaLabel}</span></div>
    {!snapshot&&!error&&<p role="status">正在加载{mediaLabel}组…</p>}
    <div className="order-grid" aria-label={`${mediaLabel}排序列表`}>
      {items.slice(page*pageSize,(page+1)*pageSize).map((item,local)=>{const index=page*pageSize+local;return <article key={item.id} data-order-id={item.id} className={`order-card ${drag===item.id?'dragging':''}`} draggable={!busy}
        onDragStart={e=>{setDrag(item.id);e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/znote-image',item.id)}} onDragEnd={()=>setDrag(null)} onDragOver={e=>{e.preventDefault();e.dataTransfer.dropEffect='move'}} onDrop={e=>{e.preventDefault();move(e.dataTransfer.getData('text/znote-image'),item.id);setDrag(null)}}>
        <div className="order-picture"><img src={item.thumbnail_url} alt={item.title} draggable={false} loading="lazy"/><span className={index===0?'order-cover-badge':'order-number'}>{index===0?'封面':index+1}</span></div>
        <div className="order-card-actions">
          <button disabled={busy||index===0} aria-label={`将第 ${index+1} 个${mediaLabel}前移`} onClick={()=>move(item.id,items[index-1].id)}><ArrowLeft size={15}/></button>
          <button className="order-grip" aria-label={`拖动第 ${index+1} 个${mediaLabel}`} disabled={busy} title="拖动调整顺序"
            onPointerDown={e=>{if(e.pointerType==='mouse')return;pointer.current=item.id;setDrag(item.id);e.currentTarget.setPointerCapture(e.pointerId)}}
            onPointerUp={e=>{if(!pointer.current)return;const target=document.elementFromPoint(e.clientX,e.clientY)?.closest('[data-order-id]');if(target)move(pointer.current,target.dataset.orderId);pointer.current=null;setDrag(null)}}
            onPointerCancel={()=>{pointer.current=null;setDrag(null)}}><GripVertical size={16}/></button>
          <button disabled={busy||index===items.length-1} aria-label={`将第 ${index+1} 个${mediaLabel}后移`} onClick={()=>move(item.id,items[index+1].id)}><ArrowRight size={15}/></button>
        </div>
        <button className="order-cover" disabled={busy||index===0} onClick={()=>{move(item.id,items[0].id);setPage(0)}}>{index===0?'当前封面':'设为封面'}</button>
      </article>})}
    </div>
    <div className="order-footer">
      {items.length>pageSize&&<nav aria-label="排序列表分页"><button disabled={busy||page===0} onClick={()=>setPage(p=>p-1)}>上一页</button><span>{page+1} / {Math.ceil(items.length/pageSize)}</span><button disabled={busy||(page+1)*pageSize>=items.length} onClick={()=>setPage(p=>p+1)}>下一页</button></nav>}
      {snapshot?.note_id&&<label><input type="checkbox" checked={sync} disabled={busy} onChange={e=>setSync(e.target.checked)}/>同步正文图片顺序</label>}
      {displayError&&<p role="alert" className="error">{displayError}</p>}
      <div className="order-actions"><button onClick={close} disabled={busy}>取消</button>{displayError&&<button onClick={load} disabled={busy}>重新加载</button>}<button className="primary" disabled={busy||!dirty} onClick={save}>{busy?'正在保存…':'保存顺序'}</button></div>
    </div>
  </Dialog>;
}
