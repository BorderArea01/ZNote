import React, {useEffect,useRef,useState} from 'react';
import {Trash2,Loader2} from 'lucide-react';
import {Dialog} from './ui.jsx';
import {send,bytes} from './api.js';
import './trash.css';

export function TrashDialog({collectionId,ids,libraryName,onClose,onDone}) {
  const [preview,setPreview]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[revision,setRevision]=useState(0);
  const submitting=useRef(false);
  const scope={collection_id:collectionId,...(ids?{ids}:{})};
  useEffect(()=>{let active=true;setPreview(null);setError('');send('/api/trash/preview',scope).then(value=>{if(active)setPreview(value)}).catch(e=>{if(active)setError(e.message)});return()=>{active=false}},[revision]);
  async function purge(){
    if(submitting.current||!preview?.count)return;
    submitting.current=true;setBusy(true);setError('');
    try{const result=await send('/api/trash/purge',{...scope,revision:preview.revision,confirm:'DELETE'});onDone(result)}
    catch(e){setError(e.message);setPreview(null)}finally{submitting.current=false;setBusy(false)}
  }
  return <Dialog title={ids?'永久删除':'清空回收站'} className="trash-dialog" onClose={()=>{if(!submitting.current)onClose()}}>
    <div className="trash-confirm-body">
      <div className="trash-confirm-symbol"><Trash2 size={25}/></div>
      <strong>{libraryName}</strong>
      {preview?<>
        <p className="trash-confirm-count">{preview.count?`永久删除 ${preview.count} 项内容`:'回收站已为空'}</p>
        <p>{ids?'仅删除所选内容。':'包括当前知识库中未显示和被筛选隐藏的回收站内容。'}删除后无法从回收站恢复，已有备份不受影响。</p>
        {preview.referenced>0&&<p>仍被笔记使用的 {preview.referenced} 项配图会保留为独立配图，笔记不再引用回收站条目。</p>}
        {preview.shared>0&&<p>其他内容仍在使用的原文件会保留。</p>}
        <small>预计释放原文件空间 {bytes(preview.reclaimable_bytes)}</small>
      </>:!error&&<p><Loader2 size={16} className="spin"/> 正在检查内容与配图引用…</p>}
      {error&&<p role="alert" className="danger">{error}</p>}
    </div>
    <footer className="trash-confirm-actions">
      <button disabled={busy} onClick={onClose}>取消</button>
      {error?<button disabled={busy} onClick={()=>setRevision(n=>n+1)}>重新检查</button>:<button className="trash-confirm-delete" disabled={busy||!preview?.count} onClick={purge}>{busy?<><Loader2 size={16} className="spin"/> 正在删除…</>:ids?'永久删除':'确认清空'}</button>}
    </footer>
  </Dialog>;
}
