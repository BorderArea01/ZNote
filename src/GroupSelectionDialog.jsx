import React,{useState} from 'react';
import {Dialog} from './ui.jsx';
import {HelpHint} from './HelpHint.jsx';
export function GroupSelectionDialog({group,selected,onClose,onApply}){
  const [ids,setIds]=useState(()=>new Set(group.rows.filter(row=>selected.has(row.id)).map(row=>row.id))),[page,setPage]=useState(0),[error,setError]=useState('');
  const rows=group.rows.slice(page*60,(page+1)*60);
  return <Dialog title="选择组内图片" className="group-selection-dialog" onClose={onClose}>
    <div className="group-selection-body"><div className="inline-heading"><strong>{group.title}</strong><HelpHint label="组内选择">仅调整本次批量操作的选择，不移出图片、不改变顺序和封面。取消则保留原选择。</HelpHint></div>
      <div className="group-selection-summary"><span>已选 {ids.size} / {group.rows.length} 张</span><button onClick={()=>setIds(new Set(group.rows.map(row=>row.id)))}>全选组内图片</button><button onClick={()=>setIds(new Set())}>清空组内选择</button></div>
      <div className="group-selection-grid">{rows.map((row,index)=><label key={row.id} className={ids.has(row.id)?'is-selected':''}><img src={`/media/${row.id}/thumbnail`} alt={row.title} loading="lazy"/><span><input type="checkbox" aria-label={`选择第 ${page*60+index+1} 张`} checked={ids.has(row.id)} onChange={()=>setIds(previous=>{const next=new Set(previous);next.has(row.id)?next.delete(row.id):next.add(row.id);return next;})}/>{page*60+index+1}{page*60+index===0?' · 首图':''}</span></label>)}</div>
    </div><footer className="group-selection-footer">{group.rows.length>60&&<nav aria-label="组内图片分页"><button disabled={!page} onClick={()=>setPage(n=>n-1)}>上一页</button><span>{page+1} / {Math.ceil(group.rows.length/60)}</span><button disabled={(page+1)*60>=group.rows.length} onClick={()=>setPage(n=>n+1)}>下一页</button></nav>}{error&&<p role="alert">{error}</p>}<div className="feature-actions"><button onClick={onClose}>取消</button><button className="primary" onClick={()=>{try{onApply([...ids]);}catch(e){setError(e.message);}}}>应用选择</button></div></footer>
  </Dialog>;
}
