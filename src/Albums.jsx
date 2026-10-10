import React,{useState,useEffect,useCallback,useRef} from 'react';
import {Star,Plus,Settings2,Trash2,Pencil,Check,ChevronDown} from 'lucide-react';
import {api,send} from './api.js';
import {Dialog,IconButton} from './ui.jsx';
import {HelpHint} from './HelpHint.jsx';
import './albums.css';

export function useAlbums(collection,enabled,revision) {
  const [albums,setAlbums]=useState([]),[error,setError]=useState('');
  const activeLibrary=useRef(collection),request=useRef(0);activeLibrary.current=collection;
  const reload=useCallback(async signal=>{
    const generation=++request.current;
    const result=await api('/api/albums?'+new URLSearchParams({collection:collection||'unfiled'}),{signal});
    if(signal?.aborted||activeLibrary.current!==collection||generation!==request.current)return result.albums;
    setAlbums(result.albums);setError('');return result.albums;
  },[collection]);
  useEffect(()=>{setAlbums([]);setError('');},[collection]);
  useEffect(()=>{if(!enabled)return;const controller=new AbortController();reload(controller.signal).catch(e=>{if(!controller.signal.aborted)setError(e.message)});return()=>controller.abort();},[enabled,revision,reload]);
  return {albums,error,reload};
}

export function AlbumNavigation({model,value,onChange,onManage}) {
  return <div className="album-navigation">
    <label className="album-select"><Star size={15}/><select aria-label="选择收藏分区" value={value||''} onChange={e=>onChange(e.target.value||null)}><option value="">默认收藏</option>{model.albums.map(row=><option key={row.id} value={row.id}>{row.name} · {row.card_count} 项</option>)}</select><ChevronDown size={14}/></label>
    <IconButton label="管理自定义相册" onClick={onManage}><Settings2 size={17}/></IconButton>
    {model.error&&<div className="album-error" role="alert">{model.error}<button onClick={()=>model.reload().catch(()=>{})}>重试</button></div>}
  </div>;
}

export function AlbumManager({collection,onClose,onChanged}) {
  const model=useAlbums(collection,true,0);
  const [draft,setDraft]=useState(''),[editing,setEditing]=useState(null),[removing,setRemoving]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function run(task) {
    if(busy)return;setBusy(true);setError('');
    try{await task();setEditing(null);setRemoving(null);await model.reload();onChanged();}
    catch(e){setError(e.message);}finally{setBusy(false);}
  }
  return <Dialog title="自定义相册" className="album-dialog" onClose={()=>{if(!busy)onClose()}}>
    <div className="album-dialog-body">
      <div className="album-heading"><strong>给收藏分个区</strong><HelpHint label="自定义相册">相册属于当前知识库，同一资源可以加入多个相册，不会复制文件。组卡片收藏整组；组内单张可通过多选管理。删除相册只移除分类，资源和默认收藏保留。移到其他知识库的资源不显示在原相册中，移回后仍保留关联。</HelpHint></div>
      <form className="album-create" onSubmit={e=>{e.preventDefault();run(async()=>{await send('/api/albums',{name:draft,collection_id:collection});setDraft('')})}}><input aria-label="新相册名称" maxLength={80} placeholder="新相册名称" value={draft} onChange={e=>setDraft(e.target.value)} disabled={busy}/><button disabled={busy||!draft.trim()}><Plus size={16}/>新建</button></form>
      {(error||model.error)&&<div role="alert" className="album-error">{error||model.error}<button disabled={busy} onClick={()=>model.reload().catch(e=>setError(e.message))}>重新加载</button></div>}
      <div className="album-manager-list">
        {model.albums.map(row=><div className="album-manager-row" key={row.id}>
          {editing?.id===row.id?<form onSubmit={e=>{e.preventDefault();run(()=>send('/api/albums/'+row.id,{name:editing.name,version:row.version},'PATCH'))}}><input autoFocus aria-label="重命名相册" maxLength={80} value={editing.name} disabled={busy} onChange={e=>setEditing({...editing,name:e.target.value})}/><button disabled={busy||!editing.name.trim()} aria-label="保存相册名称"><Check size={16}/></button><button type="button" disabled={busy} onClick={()=>setEditing(null)}>取消</button></form>:<><Star size={17}/><span>{row.name}<small>{row.card_count} 项内容</small></span><IconButton label={'重命名 '+row.name} disabled={busy} onClick={()=>{setRemoving(null);setEditing(row)}}><Pencil size={16}/></IconButton><IconButton label={'删除 '+row.name} disabled={busy} onClick={()=>{setEditing(null);setRemoving(row.id)}}><Trash2 size={16}/></IconButton></>}
          {removing===row.id&&<div className="album-delete-confirm"><span>删除“{row.name}”？资源仍然保留。</span><button className="danger" disabled={busy} onClick={()=>run(()=>send('/api/albums/'+row.id,{version:row.version},'DELETE'))}>删除相册</button><button disabled={busy} onClick={()=>setRemoving(null)}>取消</button></div>}
        </div>)}
        {!model.albums.length&&!model.error&&<div className="album-empty">创建第一个相册，收藏就有了归处。</div>}
      </div>
    </div>
    <footer className="dialog-actions"><button disabled={busy} onClick={onClose}>完成</button></footer>
  </Dialog>;
}

function Target({label,count,total,value,onChange}) {
  const ref=useRef();const mixed=value===undefined&&count>0&&count<total;
  useEffect(()=>{if(ref.current)ref.current.indeterminate=mixed;},[mixed]);
  return <label className="album-target"><input ref={ref} type="checkbox" checked={value===undefined?count===total:value} onChange={e=>onChange(e.target.checked)}/><Star size={18}/><span>{label}</span>{mixed&&<small>部分已加入</small>}</label>;
}

export function FavoriteTargets({items,collection,onClose,onDone}) {
  const [snapshot,setSnapshot]=useState(null),[choices,setChoices]=useState({}),[favorite,setFavorite]=useState(undefined),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState(''),[draft,setDraft]=useState('');
  const request=useRef(0);
  const load=useCallback(async()=>{
    const generation=++request.current;setLoading(true);setError('');
    try{const result=await send('/api/favorite-targets/preview',{items,collection_id:collection});if(generation===request.current){setSnapshot(result);setChoices(previous=>Object.fromEntries(Object.entries(previous).filter(([id])=>result.albums.some(row=>row.id===id))));}return result;}
    catch(e){if(generation===request.current)setError(e.message);}
    finally{if(generation===request.current)setLoading(false);}
  },[items,collection]);
  useEffect(()=>{load();return()=>{request.current++}},[load]);
  async function create(e) {
    e.preventDefault();if(busy)return;setBusy(true);setError('');
    try{const row=await send('/api/albums',{name:draft,collection_id:collection});const result=await load();if(result){setChoices(previous=>({...previous,[row.id]:true}));setDraft('');}}
    catch(e){setError(e.message);}finally{setBusy(false);}
  }
  async function save() {
    if(!snapshot||busy)return;setBusy(true);setError('');
    try{const result=await send('/api/favorite-targets',{items:snapshot.items.map(({id,version})=>({id,version})),collection_id:collection,groups:snapshot.groups,favorite,add:Object.keys(choices).filter(id=>choices[id]),remove:Object.keys(choices).filter(id=>!choices[id]),undo:true});await onDone(result);}
    catch(e){setError(e.message);}finally{setBusy(false);}
  }
  return <Dialog title="收藏到…" className="album-dialog" onClose={()=>{if(!busy)onClose()}}>
    <div className="album-dialog-body">
      <div className="album-heading"><strong>{snapshot?`管理 ${snapshot.items.length} 项内容的收藏`:'正在读取收藏目标…'}</strong><HelpHint label="收藏目标">默认收藏与自定义相册可以分别选择，也可以同时加入多个相册。部分已加入的目标保持原状，勾选会将本次所选全部加入，取消勾选会全部移出。收藏组卡片会包含完整图片组或视频组，不拆组。</HelpHint></div>
      {error&&<div role="alert" className="album-error">{error}<button disabled={busy||loading} onClick={load}>重新加载</button></div>}
      <fieldset disabled={busy||loading} className="album-targets">
        {snapshot&&<Target label="默认收藏" count={snapshot.favorite_count} total={snapshot.items.length} value={favorite} onChange={setFavorite}/>}
        {snapshot?.albums.map(row=><Target key={row.id} label={row.name} count={row.selected_count} total={snapshot.items.length} value={choices[row.id]} onChange={value=>setChoices(previous=>({...previous,[row.id]:value}))}/>)}
      </fieldset>
      <form className="album-create" onSubmit={create}><input aria-label="新相册名称" placeholder="新建相册并加入" maxLength={80} value={draft} disabled={busy||loading} onChange={e=>setDraft(e.target.value)}/><button disabled={busy||loading||!draft.trim()}><Plus size={16}/>新建</button></form>
    </div>
    <footer className="dialog-actions"><button disabled={busy} onClick={onClose}>取消</button><button className="primary" disabled={busy||loading||!snapshot||!!error} onClick={save}>{busy?'正在保存…':'保存收藏'}</button></footer>
  </Dialog>;
}
