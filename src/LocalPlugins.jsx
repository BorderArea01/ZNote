import React,{useState,useEffect,useRef} from 'react';
import {createPortal} from 'react-dom';
import {Puzzle,Plus,RefreshCw,ArrowUpRight} from 'lucide-react';
import {api,send} from './api.js';
import {Dialog} from './ui.jsx';
import {HelpHint} from './HelpHint.jsx';
import './local-plugins.css';

const refFor=row=>row.group_key&&row.group_size>1?{type:'group',kind:row.kind,collection_id:row.collection_id,group_key:row.group_key}:{type:'item',id:row.id};
const key=ref=>JSON.stringify(ref);
function ResourcePicker({plugin,onClose,onApply}){
  const [libraries,setLibraries]=useState([]),[library,setLibrary]=useState(''),[kind,setKind]=useState(''),[query,setQuery]=useState(''),[offset,setOffset]=useState(0);
  const [rows,setRows]=useState([]),[total,setTotal]=useState(0),[chosen,setChosen]=useState(new Map()),[busy,setBusy]=useState(false),[error,setError]=useState(''),[revision,setRevision]=useState(0);
  useEffect(()=>{api('/api/collections').then(setLibraries).catch(e=>setError(e.message));},[]);
  useEffect(()=>{
    const controller=new AbortController();setBusy(true);setError('');
    const params=new URLSearchParams({grouped:'true',summary:'true',limit:'40',offset:String(offset),q:query,...(library?{collection:library}:{}),...(kind&&kind!=='file'?{kind}:{})});
    const request=kind==='file'?api(`/api/plugins/${plugin.id}/files`,{signal:controller.signal}).then(r=>({items:r.files.filter(f=>f.name.includes(query)).map(f=>({id:f.id,title:f.name,kind:'file'}))})):api('/api/items?'+params,{signal:controller.signal});
    const timer=setTimeout(()=>request.then(result=>{if(!controller.signal.aborted){setRows(result.items);setTotal(result.total??result.items.length);}}).catch(e=>{if(!controller.signal.aborted)setError(e.message)}).finally(()=>{if(!controller.signal.aborted)setBusy(false)}),180);
    // Attach a rejection handler immediately; an aborted request may settle
    // before the debounce timer fires.
    request.catch(()=>{});
    return()=>{clearTimeout(timer);controller.abort();};
  },[library,kind,query,offset,plugin.id,revision]);
  const change=(set,value)=>{set(value);setOffset(0);};
  return <Dialog title="挂载知识库素材" onClose={onClose} className="plugin-picker">
    <div className="plugin-picker-tools"><input aria-label="搜索素材" placeholder="搜索标题、正文或标签" value={query} onChange={e=>change(setQuery,e.target.value)}/><select aria-label="素材知识库" value={library} disabled={kind==='file'} onChange={e=>change(setLibrary,e.target.value)}><option value="">全部知识库</option><option value="unfiled">未分类</option>{libraries.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select><select aria-label="素材类型" value={kind} onChange={e=>change(setKind,e.target.value)}><option value="">全部类型</option><option value="image">图片 / 图片组</option><option value="video">视频 / 视频组</option><option value="note">笔记</option><option value="file">已有插件附件</option></select><HelpHint label="素材挂载">这里只创建引用，不重新上传或移动原素材。图组和视频组作为整体挂载。原件被删除或分组改变时，会显示不可用；可解除挂载后重新选择。附件上传后可在多个角色卡之间重复引用。</HelpHint></div>
    {error&&<div role="alert" className="error-banner">{error}<button onClick={()=>setRevision(n=>n+1)}>重试</button></div>}
    <div className="plugin-picker-grid" aria-busy={busy}>{rows.map(row=>{const ref=row.kind==='file'?{type:'file',id:row.id}:refFor(row),id=key(ref);return <button key={row.id} disabled={busy} className={chosen.has(id)?'picked':''} aria-pressed={chosen.has(id)} onClick={()=>setChosen(old=>{const next=new Map(old);next.has(id)?next.delete(id):next.set(id,{ref,title:row.group_title||row.title});return next;})}>{row.thumbnail_url?<img src={row.thumbnail_url} alt="" loading="lazy"/>:<span className="plugin-resource-symbol">{row.kind==='note'?'文':row.kind==='file'?'附件':'影'}</span>}<strong>{row.group_title||row.title}</strong><small>{row.group_size>1?`${row.group_size} ${row.kind==='video'?'个视频':'张图片'}`:row.kind==='note'?'笔记':row.kind==='file'?'附件':'单项'}</small></button>})}{!rows.length&&!busy&&<p>没有找到素材</p>}{busy&&<p role="status">正在读取素材…</p>}</div>
    <footer className="plugin-picker-footer"><button disabled={busy||!offset||kind==='file'} onClick={()=>setOffset(n=>Math.max(0,n-40))}>上一页</button><span>{kind==='file'?total:`${Math.min(offset+1,total)}–${Math.min(offset+40,total)} / ${total}`}</span><button disabled={busy||offset+40>=total||kind==='file'} onClick={()=>setOffset(n=>n+40)}>下一页</button><button className="primary" disabled={!chosen.size||busy} onClick={()=>onApply([...chosen.values()])}>挂载 {chosen.size} 项</button></footer>
  </Dialog>;
}

export function LocalPlugins({onOpenItem,previewing=false,onNavigate=()=>{}}){
  const [catalog,setCatalog]=useState({plugins:[],errors:[]}),[manager,setManager]=useState(false),[opened,setOpened]=useState(null),[picker,setPicker]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[revision,setRevision]=useState(0);
  const frame=useRef(),current=useRef();current.current={onOpenItem,opened};
  const refresh=async()=>{const result=await api('/api/plugins');setCatalog(result);setOpened(old=>old&&result.plugins.some(p=>p.id===old.id&&p.enabled)?old:null);return result;};
  useEffect(()=>{refresh().catch(()=>{});const reload=()=>refresh().catch(()=>{});window.addEventListener('focus',reload);return()=>window.removeEventListener('focus',reload);},[]);
  useEffect(()=>{if(!opened)return;const timer=setInterval(()=>refresh().catch(()=>{}),5000);return()=>clearInterval(timer);},[opened?.id]);
  useEffect(()=>{
    const listener=async event=>{
      if(event.origin!==location.origin||event.source!==frame.current?.contentWindow||event.data?.type!=='znote:plugin')return;
      const {action,requestId,id}=event.data;
      if(action==='pick-resources')setPicker({requestId,source:event.source});
      if(action==='open-item'&&/^[a-f0-9-]{36}$/i.test(id))try{await current.current.onOpenItem(id);}catch(e){event.source.postMessage({type:'znote:host',requestId,error:e.message},location.origin);}
      if(action==='close')setOpened(null);
      if(action==='help')setError('');
    };
    window.addEventListener('message',listener);return()=>window.removeEventListener('message',listener);
  },[]);
  async function run(operation){setBusy(true);setError('');try{await operation();}catch(e){setError(e.message);}finally{setBusy(false);}}
  const choose=result=>{picker?.source.postMessage({type:'znote:host',requestId:picker.requestId,result},location.origin);setPicker(null);};
  return <>
    <div className="nav-caption">创作插件<button className="icon-button" aria-label="管理本地插件" onClick={()=>{onNavigate();setManager(true)}}><Puzzle size={16}/></button></div>
    <nav className="local-plugin-nav">{catalog.plugins.filter(p=>p.enabled).map(p=><button key={p.id} onClick={()=>{onNavigate();setOpened(p);setError('');}}><Puzzle size={17}/>{p.name}<ArrowUpRight size={14}/></button>)}{!catalog.plugins.some(p=>p.enabled)&&<button onClick={()=>{onNavigate();setManager(true)}}><Plus size={16}/>添加创作工具</button>}</nav>
    {createPortal(<>
      {manager&&<Dialog title="本地插件管理" className="plugin-manager" onClose={()=>setManager(false)}><div className="plugin-manager-tools"><code>plugins/</code><HelpHint label="本地插件管理">将可信插件文件夹放入开发机 ZNote 根目录的 plugins，再重新扫描。整个目录已被 Git 忽略。插件页面运行在本机站点内，能够访问已授权的知识库，请只安装可信来源。停用或移走插件文件夹会卸载页面，角色资料和附件仍保留在 data 中，并随完整备份保存。重新放回同一标识的插件即可继续使用。</HelpHint><button disabled={busy} onClick={()=>run(async()=>{setCatalog(await send('/api/plugins/rescan',{}));await refresh();setRevision(n=>n+1);})}><RefreshCw size={15}/>重新扫描</button></div>{catalog.errors.map(p=><div role="alert" key={p.id}>{p.id}：{p.error}</div>)}{error&&<div role="alert">{error}</div>}<div className="plugin-manager-list">{catalog.plugins.map(p=><article key={p.id}><div><strong>{p.name}</strong><small>v{p.version} · {p.enabled?'已启用':'已停用'}</small><p>{p.description}</p></div><button disabled={busy} onClick={()=>run(async()=>{setCatalog(await send('/api/plugins/'+p.id,{enabled:!p.enabled},'PATCH'));if(opened?.id===p.id)setOpened(null);})}>{p.enabled?'停用':'启用'}</button>{p.enabled&&<button disabled={busy} onClick={()=>{setManager(false);setOpened(p);}}>打开</button>}</article>)}{!catalog.plugins.length&&<p>暂无本地插件。放入插件文件夹后，点击重新扫描。</p>}</div></Dialog>}
      {opened&&<div style={previewing?{visibility:'hidden',pointerEvents:'none'}:undefined} inert={previewing?true:undefined}><Dialog title={opened.name} className="plugin-workspace" onClose={()=>{setOpened(null);setPicker(null);}}><iframe key={opened.id+revision} ref={frame} title={opened.name+'工作台'} src={`/local-plugins/${opened.id}/${opened.entry}?v=${revision}`} />{error&&<div role="alert">{error}</div>}</Dialog></div>}
      {picker&&opened&&<ResourcePicker plugin={opened} onClose={()=>choose([])} onApply={choose}/>}
    </>,document.body)}
  </>;
}
