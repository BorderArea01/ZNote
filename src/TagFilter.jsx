import React, { useEffect, useId, useState } from 'react';
import { Hash, Search, X, Images, ChevronDown } from 'lucide-react';
import { HelpHint } from './HelpHint.jsx';
import {useTagPage} from './useTagPage.js';
import './tag-filter.css';

export function TagFilter({ collection, revision, selected, mode, onToggle, onMode, onClear, onBrowse, busy, videos = false, variant = 'content' }) {
  const sidebar=variant==='sidebar',panel=useId();
  const [open,setOpen]=useState(!sidebar),[query, setQuery] = useState('');
  const [page,setPage]=useState({offset:0,cursor:undefined}),[retry,setRetry]=useState(0);
  useEffect(()=>setPage({offset:0,cursor:undefined}),[revision]);
  const model=useTagPage(collection,{query,...page,revision:revision+':'+retry,enabled:open});
  const reset=()=>{setPage({offset:0,cursor:undefined});setRetry(n=>n+1)};
  const move=offset=>setPage({offset,cursor:model.cursor});
  return <section className={sidebar?'sidebar-tag-filter':'tag-browser tag-filter'} aria-label={sidebar?'侧栏多标签筛选':'按标签筛选'}>
    <div className="tag-filter-heading">
      <button className="tag-filter-toggle" aria-expanded={open} aria-controls={panel} onClick={()=>setOpen(value=>!value)}><Hash size={16}/><strong>{sidebar?'多标签筛选':'按标签筛选'}</strong>{selected.length>0&&<span className="tag-filter-count">{selected.length}</span>}<ChevronDown size={15} className={open?'expanded':''}/></button>
      {!sidebar&&<HelpHint label="标签筛选">展开后搜索当前知识库的标签，可以匹配全部或任意标签。切换标签页或收起面板不会清空已选条件。{!videos && '筛选后可连续浏览这组图片。'}</HelpHint>}
      {!sidebar&&onBrowse&&<button disabled={busy} onClick={onBrowse}><Images size={16}/>连续浏览图片</button>}
    </div>
    {!open&&selected.length>0&&<div className="tag-filter-summary"><span>已选 {selected.length} 个 · {mode==='all'?'全部匹配':'任意匹配'}</span><button className="text-button" onClick={onClear}>清除筛选</button></div>}
    {open&&<div id={panel}>
      <div className="tag-browser-tools">
        <label className="tag-search"><Search size={15}/><input aria-label={sidebar?'搜索侧栏标签':'搜索筛选标签'} placeholder="搜索标签…" value={query} maxLength={200} onChange={e=>{setQuery(e.target.value);setPage({offset:0,cursor:undefined});}}/></label>
        <select aria-label="标签匹配方式" value={mode} onChange={e=>onMode(e.target.value)}><option value="all">全部匹配</option><option value="any">任意匹配</option></select>
      </div>
      <div className="tag-options" aria-label="可选标签">
        {model.tags.map(tag=><button key={tag.name} title={tag.name} aria-label={'筛选标签：'+tag.name} aria-pressed={selected.includes(tag.name)} onClick={()=>onToggle(tag.name)}><span># {tag.name}</span><small>{tag.count}</small></button>)}
        {model.loading&&<span role="status" className="muted">正在查找标签…</span>}
        {model.error&&<span role="alert">{model.error.message} <button onClick={reset}>{model.error.status===409?'刷新标签':'重试标签'}</button></span>}
        {!model.loading&&!model.error&&!model.tags.length&&<span className="muted">{query?'没有匹配的标签，试试其他关键词。':'还没有标签'}</span>}
      </div>
      {(model.total>40||page.offset>0)&&<nav className="tag-pages" aria-label="标签分页"><button aria-label="上一页标签" disabled={model.loading||!!model.error||!page.offset} onClick={()=>move(Math.max(0,page.offset-40))}>上一页</button><span>{model.loading?'加载中…':model.error?'需刷新':(page.offset+1)+'–'+Math.min(page.offset+40,model.total)+' / '+model.total}</span><button aria-label="下一页标签" disabled={model.loading||!!model.error||page.offset+40>=model.total} onClick={()=>move(page.offset+40)}>下一页</button></nav>}
      {selected.length>0&&<div className="tag-selection" aria-label="已选标签">
        <span>{selected.length} 个 · {mode==='all'?'全部匹配':'任意匹配'}</span>
        {selected.map(tag=><button key={tag} aria-label={'移除筛选标签：'+tag} title={tag} onClick={()=>onToggle(tag)}><span>{tag}</span><X size={12}/></button>)}
        <button className="text-button" onClick={onClear}>清除筛选</button>
      </div>}
    </div>}
  </section>;
}
