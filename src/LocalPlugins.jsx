import React,{useState,useEffect,useRef,useCallback} from 'react';
import {createPortal} from 'react-dom';
import {Puzzle,Plus,RefreshCw,ArrowUpRight} from 'lucide-react';
import {api,send} from './api.js';
import {Dialog} from './ui.jsx';
import {HelpHint} from './HelpHint.jsx';
import './local-plugins.css';
import {Select} from './Select.jsx';

const refFor=row=>row.group_key&&row.group_size>1?{type:'group',kind:row.kind,collection_id:row.collection_id,group_key:row.group_key}:{type:'item',id:row.id};
const key=ref=>JSON.stringify(ref);
function ResourcePicker({plugin,collection,onClose,onApply}){
  const [libraries,setLibraries]=useState([]),[library,setLibrary]=useState(collection||'unfiled'),[kind,setKind]=useState(''),[query,setQuery]=useState(''),[offset,setOffset]=useState(0);
  const [rows,setRows]=useState([]),[total,setTotal]=useState(0),[chosen,setChosen]=useState(new Map()),[busy,setBusy]=useState(false),[error,setError]=useState(''),[revision,setRevision]=useState(0);
  useEffect(()=>{api('/api/collections').then(setLibraries).catch(e=>setError(e.message));},[]);
  useEffect(()=>{
    const controller=new AbortController();setBusy(true);setError('');
    const params=new URLSearchParams({grouped:'true',summary:'true',limit:'40',offset:String(offset),q:query,...(library?{collection:library}:{}),...(kind&&kind!=='file'?{kind}:{})});
    const request=kind==='file'?api(`/api/plugins/${plugin.id}/files?collection=${collection||'unfiled'}`,{signal:controller.signal}).then(r=>({items:r.files.filter(f=>f.name.includes(query)).map(f=>({id:f.id,title:f.name,kind:'file'}))})):api('/api/items?'+params,{signal:controller.signal});
    const timer=setTimeout(()=>request.then(result=>{if(!controller.signal.aborted){setRows(result.items);setTotal(result.total??result.items.length);}}).catch(e=>{if(!controller.signal.aborted)setError(e.message)}).finally(()=>{if(!controller.signal.aborted)setBusy(false)}),180);
    // Attach a rejection handler immediately; an aborted request may settle
    // before the debounce timer fires.
    request.catch(()=>{});
    return()=>{clearTimeout(timer);controller.abort();};
  },[library,kind,query,offset,plugin.id,revision]);
  const change=(set,value)=>{set(value);setOffset(0);};
  return <Dialog title="挂载知识库素材" onClose={onClose} className="plugin-picker">
    <div className="plugin-picker-tools"><input aria-label="搜索素材" placeholder="搜索标题、正文或标签" value={query} onChange={e=>change(setQuery,e.target.value)}/><Select label="素材知识库" value={library||'all'} disabled={kind==='file'} onChange={value=>change(setLibrary,value==='all'?'':value)} options={[{value:'all',label:'全部知识库'},{value:'unfiled',label:'未分类'},...libraries.map(c=>({value:c.id,label:c.name}))]}/><Select label="素材类型" value={kind||'all'} onChange={value=>change(setKind,value==='all'?'':value)} options={[{value:'all',label:'全部类型'},{value:'image',label:'图片 / 图片组'},{value:'video',label:'视频 / 视频组'},{value:'note',label:'笔记'},{value:'file',label:'当前库插件附件'}]}/><HelpHint label="素材挂载">这里只创建引用，不重新上传或移动原素材。图组和视频组作为整体挂载。原件被删除或分组改变时，会显示不可用；可解除挂载后重新选择。附件上传后可在多个角色卡之间重复引用。</HelpHint></div>
    {error&&<div role="alert" className="error-banner">{error}<button onClick={()=>setRevision(n=>n+1)}>重试</button></div>}
    <div className="plugin-picker-grid" aria-busy={busy}>{rows.map(row=>{const ref=row.kind==='file'?{type:'file',id:row.id}:refFor(row),id=key(ref);return <button key={row.id} disabled={busy} className={chosen.has(id)?'picked':''} aria-pressed={chosen.has(id)} onClick={()=>setChosen(old=>{const next=new Map(old);next.has(id)?next.delete(id):next.set(id,{ref,title:row.group_title||row.title});return next;})}>{row.thumbnail_url?<img src={row.thumbnail_url} alt="" loading="lazy"/>:<span className="plugin-resource-symbol">{row.kind==='note'?'文':row.kind==='file'?'附件':'影'}</span>}<strong>{row.group_title||row.title}</strong><small>{row.group_size>1?`${row.group_size} ${row.kind==='video'?'个视频':'张图片'}`:row.kind==='note'?'笔记':row.kind==='file'?'附件':'单项'}</small></button>})}{!rows.length&&!busy&&<p>没有找到素材</p>}{busy&&<p role="status">正在读取素材…</p>}</div>
    <footer className="plugin-picker-footer"><button disabled={busy||!offset||kind==='file'} onClick={()=>setOffset(n=>Math.max(0,n-40))}>上一页</button><span>{kind==='file'?total:`${Math.min(offset+1,total)}–${Math.min(offset+40,total)} / ${total}`}</span><button disabled={busy||offset+40>=total||kind==='file'} onClick={()=>setOffset(n=>n+40)}>下一页</button><button className="primary" disabled={!chosen.size||busy} onClick={()=>onApply([...chosen.values()])}>挂载 {chosen.size} 项</button></footer>
  </Dialog>;
}

export function LocalPlugins({collection,libraryName,onOpenItem,previewing=false,onNavigate=()=>{}}){
  const scope=collection||'unfiled',query='collection='+encodeURIComponent(scope),path=url=>url+'?'+query;
  const [catalog,setCatalog]=useState({plugins:[],errors:[]}),[manager,setManager]=useState(false),[opened,setOpened]=useState(null),[picker,setPicker]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[revision,setRevision]=useState(0);
  const frame=useRef(),current=useRef(),alive=useRef(true);current.current={onOpenItem,opened};
  const refresh=useCallback(async signal=>{const result=await api('/api/plugins?collection='+encodeURIComponent(scope),{signal});if(alive.current&&!signal?.aborted){setCatalog(result);setOpened(old=>old&&result.plugins.some(p=>p.id===old.id&&p.enabled)?old:null);}return result;},[scope]);
  useEffect(()=>{alive.current=true;const controller=new AbortController();refresh(controller.signal).catch(e=>{if(!controller.signal.aborted)setError(e.message)});const reload=()=>refresh().catch(e=>{if(alive.current)setError(e.message)});window.addEventListener('focus',reload);return()=>{alive.current=false;controller.abort();window.removeEventListener('focus',reload);};},[refresh]);
  useEffect(()=>{if(!opened)return;const timer=setInterval(()=>refresh().catch(e=>{if(alive.current)setError(e.message)}),5000);return()=>clearInterval(timer);},[opened?.id,refresh]);
  useEffect(()=>{
    const listener=async event=>{
      if(event.origin!==location.origin||event.source!==frame.current?.contentWindow||event.data?.type!=='znote:plugin')return;
      const {action,requestId,id}=event.data;
      if(action==='pick-resources')setPicker({requestId,source:event.source});
      if(action==='open-item'&&/^[a-f0-9-]{36}$/i.test(id))try{await current.current.onOpenItem(id);}catch(e){event.source.postMessage({type:'znote:host',requestId,error:e.message},location.origin);}
      if(action==='close')setOpened(null);
    };
    window.addEventListener('message',listener);return()=>window.removeEventListener('message',listener);
  },[]);
  async function run(operation){if(busy)return;setBusy(true);setError('');try{await operation();}catch(e){setError(e.message);}finally{if(alive.current)setBusy(false);}}
  const choose=result=>{picker?.source.postMessage({type:'znote:host',requestId:picker.requestId,result},location.origin);setPicker(null);};
  const enabled=catalog.plugins.filter(p=>p.enabled),manage=()=>{onNavigate();setManager(true);};
  return <>
    {enabled.length>0?<><div className="nav-caption">知识库工具<button className="icon-button" aria-label="管理知识库插件" onClick={manage}><Puzzle size={16}/></button></div><nav className="local-plugin-nav">{enabled.map(p=><button key={p.id} onClick={()=>{onNavigate();setOpened(p);setError('');}}><Puzzle size={17}/>{p.name}<ArrowUpRight size={14}/></button>)}</nav></>:<button className="local-plugin-manage-entry" aria-label="管理知识库插件" onClick={manage}><Puzzle size={15}/><span>插件设置</span><Plus size={14}/></button>}
    {createPortal(<>
      {manager&&<Dialog title="知识库插件" className="plugin-manager" onClose={()=>{if(!busy)setManager(false)}}>
        <div className="plugin-manager-heading"><span className="plugin-library-badge">{libraryName}</span><HelpHint label="知识库插件">插件按知识库启用，普通库默认不挂载。停用只关闭本知识库入口，资料与附件保留；再次启用可以继续使用。将可信插件放入开发机 plugins 文件夹后重新扫描，插件源码仍不进入Git。跨库素材可以通过引用选择器复用，不需要重新导入。</HelpHint><button disabled={busy} onClick={()=>run(async()=>{setCatalog(await send(path('/api/plugins/rescan'),{}));setRevision(n=>n+1);})}><RefreshCw size={15}/>重新扫描</button></div>
        {catalog.errors.map(p=><div role="alert" className="plugin-manager-error" key={p.id}>{p.id}：{p.error}</div>)}{error&&<div role="alert" className="plugin-manager-error">{error}<button disabled={busy} onClick={()=>run(refresh)}>重试</button></div>}
        <div className="plugin-manager-list">{catalog.plugins.map(p=><article key={p.id}><div className="plugin-manager-icon"><Puzzle size={22}/></div><div className="plugin-manager-info"><strong>{p.name}</strong><small>版本 {p.version} · {p.enabled?'已在本知识库启用':'本知识库未启用'}</small><p>{p.description}</p>{p.legacy_available&&<button className="text-button" disabled={busy} onClick={()=>run(async()=>setCatalog(await send(path('/api/plugins/'+p.id+'/legacy/claim'),{version:p.legacy_version})))}>将旧资料关联到本知识库</button>}</div><div className="plugin-manager-actions"><button role="switch" aria-checked={p.enabled} aria-label={'在本知识库启用 '+p.name} disabled={busy} className={'plugin-switch '+(p.enabled?'is-on':'')} onClick={()=>run(async()=>{setCatalog(await send(path('/api/plugins/'+p.id),{enabled:!p.enabled},'PATCH'));if(opened?.id===p.id){setOpened(null);setPicker(null);}})}><span/></button>{p.enabled&&<button disabled={busy} onClick={()=>{setManager(false);setOpened(p);}}>打开</button>}</div></article>)}{!catalog.plugins.length&&<div className="plugin-manager-empty"><Puzzle size={28}/><strong>这里还没有可用插件</strong><span>放入插件文件夹后，重新扫描即可添加。</span></div>}</div>
      </Dialog>}
      {opened&&<div style={previewing?{visibility:'hidden',pointerEvents:'none'}:undefined} inert={previewing?true:undefined}><Dialog title={opened.name+' · '+libraryName} className="plugin-workspace" onClose={()=>{setOpened(null);setPicker(null);}}><iframe key={opened.id+revision+scope} ref={frame} title={opened.name+'工作台'} src={'/local-plugins/'+opened.id+'/'+opened.entry+'?'+query+'&v='+revision}/>{error&&<div role="alert" className="plugin-manager-error">{error}</div>}</Dialog></div>}
      {picker&&opened&&<ResourcePicker plugin={opened} collection={collection} onClose={()=>choose([])} onApply={choose}/>}
    </>,document.body)}
  </>;
}
