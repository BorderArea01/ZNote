import React, { useEffect, useState } from 'react';
import { Hash, Search, X, Images } from 'lucide-react';
import { HelpHint } from './HelpHint.jsx';
import {useTagPage} from './useTagPage.js';

export function TagFilter({ collection, revision, selected, mode, onToggle, onMode, onClear, onBrowse, busy, videos = false }) {
  const [query, setQuery] = useState('');
  const [page,setPage]=useState({offset:0,cursor:undefined}),[retry,setRetry]=useState(0);
  useEffect(()=>setPage({offset:0,cursor:undefined}),[revision]);
  const model=useTagPage(collection,{query,...page,revision:revision+':'+retry});
  const reset=()=>{setPage({offset:0,cursor:undefined});setRetry(n=>n+1)};
  const move=offset=>setPage({offset,cursor:model.cursor});
  return <section className="tag-browser" aria-label="按标签筛选">
    <div className="tag-browser-heading">
      <div className="inline-heading"><strong><Hash size={16} />按标签筛选</strong><HelpHint label="标签筛选">选择一个或多个标签；再次点击取消。可以匹配全部或任意标签。{!videos && '筛选后可连续浏览这组图片。'}</HelpHint></div>
      {onBrowse && <button className="primary" disabled={busy} onClick={onBrowse}><Images size={16} />连续浏览图片</button>}
    </div>
    <div className="tag-browser-tools">
      <label className="tag-search"><Search size={15} /><input aria-label="搜索筛选标签" placeholder="搜索当前知识库标签…" value={query} maxLength={200} onChange={e => {setQuery(e.target.value);setPage({offset:0,cursor:undefined});}} /></label>
      <select aria-label="标签匹配方式" value={mode} onChange={e => onMode(e.target.value)}>
        <option value="all">全部匹配</option><option value="any">任意匹配</option>
      </select>
    </div>
    <div className="tag-options" aria-label="可选标签">
      {model.tags.map(tag => <button key={tag.name} aria-label={`筛选标签：${tag.name}`} aria-pressed={selected.includes(tag.name)} onClick={() => onToggle(tag.name)}># {tag.name}<small>{tag.count}</small></button>)}
      {model.loading&&<span role="status" className="muted">正在查找标签…</span>}
      {model.error&&<span role="alert">{model.error.message} <button onClick={reset}>{model.error.status===409?'刷新标签':'重试标签'}</button></span>}
      {!model.loading&&!model.error&&!model.tags.length && <span className="muted">{query ? '没有匹配的标签，试试其他关键词。' : '还没有标签，可在上传或批量整理时添加。'}</span>}
    </div>
    {(model.total>40||page.offset>0)&&<nav className="tag-pages" aria-label="标签分页"><button disabled={model.loading||!!model.error||!page.offset} onClick={()=>move(Math.max(0,page.offset-40))}>上一页标签</button><span>{model.loading?'加载中…':model.error?'标签需要刷新':`${page.offset+1}–${Math.min(page.offset+40,model.total)} / ${model.total}`}</span><button disabled={model.loading||!!model.error||page.offset+40>=model.total} onClick={()=>move(page.offset+40)}>下一页标签</button></nav>}
    {selected.length > 0 && <div className="tag-selection" aria-live="polite">
        <span>已选 {selected.length} 个 · {mode === 'all' ? '全部匹配' : '任意匹配'}</span>
        {selected.map(tag => <button key={tag} aria-label={`移除筛选标签：${tag}`} onClick={() => onToggle(tag)}>{tag}<X size={12} /></button>)}
        <button className="text-button" onClick={onClear}>清除筛选</button>
    </div>}
  </section>;
}
