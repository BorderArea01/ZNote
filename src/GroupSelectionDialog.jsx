import React,{useRef,useState} from 'react';
import {Unlink} from 'lucide-react';
import {Dialog} from './ui.jsx';
import {HelpHint} from './HelpHint.jsx';
export function GroupSelectionDialog({group,selected,onClose,onApply,onDetach,onDetached}){
  const [ids,setIds]=useState(()=>new Set(group.rows.filter(row=>selected.has(row.id)).map(row=>row.id))),[page,setPage]=useState(0),[error,setError]=useState(''),[busyId,setBusyId]=useState(null);
  const pending=useRef(null),noteGroup=(group.groupKey||group.rows[0]?.group_key||'').startsWith('note:');
  const rows=group.rows.slice(page*60,(page+1)*60);
  async function detach(row,index){
    if(busyId)return;setBusyId(row.id);setError('');
    try{
      const result=await onDetach(row,pending.current?.id===row.id?pending.current.plan:null);
      pending.current=null;onDetached(result,row,index);
    }catch(e){
      pending.current=e.retryPlan?{id:row.id,plan:e.retryPlan}:null;
      setError(e.status?e.message:'尚未确认移出结果，请再点一次“重试移出”；不会重复操作。');
    }finally{setBusyId(null)}
  }
  return <Dialog title="选择组内图片" className="group-selection-dialog" onClose={()=>!busyId&&onClose()}>
    <div className="group-selection-body"><div className="inline-heading"><strong>{group.title}</strong><HelpHint label="组内操作">点击图片可调整本次批量选择；“移出组”只拆出对应图片并可撤销，不改变其他图片的顺序和封面。{noteGroup?'笔记配图请在笔记正文中增删，避免正文引用与配图组不一致。':''}</HelpHint></div>
      <div className="group-selection-summary"><span>已选 {ids.size} / {group.rows.length} 张</span><button onClick={()=>setIds(new Set(group.rows.map(row=>row.id)))}>全选组内图片</button><button onClick={()=>setIds(new Set())}>清空组内选择</button></div>
      <div className="group-selection-grid">{rows.map((row,index)=>{const position=page*60+index+1;return <div key={row.id} className={`group-selection-card${ids.has(row.id)?' is-selected':''}`}><label><img src={`/media/${row.id}/thumbnail`} alt={row.title} loading="lazy"/><span><input type="checkbox" aria-label={`选择第 ${position} 张`} checked={ids.has(row.id)} disabled={!!busyId} onChange={()=>setIds(previous=>{const next=new Set(previous);next.has(row.id)?next.delete(row.id):next.add(row.id);return next;})}/>{position}{position===1?' · 首图':''}</span></label>{!noteGroup&&<button className="group-detach-button" disabled={!!busyId} onClick={()=>detach(row,position-1)} aria-label={`${busyId===row.id&&pending.current?.id===row.id?'重试移出':'移出'}第 ${position} 张图片`}><Unlink size={14}/>{busyId===row.id?'正在移出…':pending.current?.id===row.id?'重试移出':'移出组'}</button>}</div>})}</div>
    </div><footer className="group-selection-footer">{group.rows.length>60&&<nav aria-label="组内图片分页"><button disabled={!page||!!busyId} onClick={()=>setPage(n=>n-1)}>上一页</button><span>{page+1} / {Math.ceil(group.rows.length/60)}</span><button disabled={(page+1)*60>=group.rows.length||!!busyId} onClick={()=>setPage(n=>n+1)}>下一页</button></nav>}{error&&<p className="error" role="alert">{error}</p>}<div className="feature-actions"><button disabled={!!busyId} onClick={onClose}>取消</button><button className="primary" disabled={!!busyId} onClick={()=>{try{onApply([...ids]);}catch(e){setError(e.message);}}}>应用选择</button></div></footer>
  </Dialog>;
}
