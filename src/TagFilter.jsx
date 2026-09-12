import React, { useState } from 'react';
import { Hash, Search, X, Images } from 'lucide-react';

export function TagFilter({ tags, selected, mode, onToggle, onMode, onClear, onBrowse, busy, videos = false }) {
  const [query, setQuery] = useState('');
  const visible = tags.filter(tag => tag.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <section className="tag-browser" aria-label="按标签筛选">
    <div className="tag-browser-heading">
      <div><strong><Hash size={16} />按标签筛选</strong><p>{videos ? '选择一个或多个标签，查找符合条件的视频。' : '选择一个或多个标签，连续浏览符合条件的图片。'}</p></div>
      {onBrowse && <button className="primary" disabled={busy} onClick={onBrowse}><Images size={16} />连续浏览图片</button>}
    </div>
    <div className="tag-browser-tools">
      <label className="tag-search"><Search size={15} /><input aria-label="搜索筛选标签" placeholder="搜索全部标签…" value={query} onChange={e => setQuery(e.target.value)} /></label>
      <select aria-label="标签匹配方式" value={mode} onChange={e => onMode(e.target.value)}>
        <option value="all">同时包含全部标签</option><option value="any">包含任意标签</option>
      </select>
    </div>
    <div className="tag-options" aria-label="可选标签">
      {visible.map(tag => <button key={tag.name} aria-label={`筛选标签：${tag.name}`} aria-pressed={selected.includes(tag.name)} onClick={() => onToggle(tag.name)}># {tag.name}</button>)}
      {!visible.length && <span className="muted">{tags.length ? '没有匹配的标签，试试其他关键词。' : '还没有标签，可在上传或批量整理时添加。'}</span>}
    </div>
    <div className="tag-selection" aria-live="polite">
      {selected.length ? <>
        <span>已选 {selected.length} 个 · {mode === 'all' ? '全部匹配' : '任意匹配'}</span>
        {selected.map(tag => <button key={tag} aria-label={`移除筛选标签：${tag}`} onClick={() => onToggle(tag)}>{tag}<X size={12} /></button>)}
        <button className="text-button" onClick={onClear}>清除筛选</button>
      </> : <span>未限定标签 · 点击标签即可筛选，再次点击取消</span>}
    </div>
  </section>;
}
