import React, { useEffect, useState } from 'react';
import { Bookmark, Plus, MoreHorizontal, RefreshCw } from 'lucide-react';
import { api } from './api.js';
import { IconButton } from './ui.jsx';
import { HelpHint } from './HelpHint.jsx';
import { viewSignature } from '../shared/saved-views.js';

export function useSavedViews(library, enabled) {
  const [state, setState] = useState({}), [revision, setRevision] = useState(0);
  const reload = () => setRevision(n => n + 1);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setState(previous => ({ ...previous, loading: true, error: '' }));
    api('/api/saved-views?collection=' + encodeURIComponent(library || 'unfiled'), { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setState({ library, rows: result.views, loading: false, error: '' }); })
      .catch(e => { if (!controller.signal.aborted) setState(previous => ({ ...previous, loading: false, error: e.message })); });
    return () => controller.abort();
  }, [library, enabled, revision]);
  useEffect(() => { if (!enabled) return; window.addEventListener('focus', reload); return () => window.removeEventListener('focus', reload); }, [enabled]);
  return { rows: enabled && state.library === library ? state.rows || [] : [], loading: !!state.loading, error: state.error, reload };
}

export function SavedViewList({ model, config, onApply, onEdit, onCreate }) {
  const active = model.rows.find(row => viewSignature(row.config) === viewSignature(config))?.id;
  return <section className="saved-view-section" aria-label="常用筛选">
    <div className="nav-caption"><span>常用筛选 <HelpHint label="常用筛选说明">保存当前知识库的分类、关键词、标签组合、排序与布局；其他设备登录同一服务也能使用。</HelpHint></span><IconButton label="保存当前筛选" onClick={onCreate}><Plus size={15}/></IconButton></div>
    <nav className="saved-view-list" aria-label="已保存的筛选">{model.rows.map(row => <div className="collection-row" key={row.id}>
      <button className={active === row.id ? 'active' : ''} aria-pressed={active === row.id} title={row.name} onClick={() => onApply(row)}><Bookmark size={16}/><b>{row.name}</b></button>
      <IconButton label={`管理筛选 ${row.name}`} onClick={() => onEdit(row)}><MoreHorizontal size={15}/></IconButton>
    </div>)}</nav>
    {model.error ? <div className="saved-view-status" role="status"><span>筛选读取失败</span><IconButton label="重新读取筛选" onClick={model.reload}><RefreshCw size={14}/></IconButton></div> : !model.rows.length && <button className="saved-view-empty" onClick={onCreate}>{model.loading ? '正在读取…' : '保存一组常用条件'}</button>}
  </section>;
}
