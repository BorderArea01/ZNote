import React, { useState } from 'react';
import { Dialog } from './ui.jsx';
import { api, send } from './api.js';
import { savedViewLabels, viewSignature } from '../shared/saved-views.js';

function Conditions({ config }) {
  return <div className="saved-view-conditions" aria-label="保存的筛选条件">
    <div className="saved-view-chips"><span>{savedViewLabels[config.view]}</span><span>{{ updated:'最近更新', created:'最近创建', title:'名称排序' }[config.sort]}</span><span>{{grid:'网格',list:'列表','compact-grid':'紧密网格','compact-list':'紧密列表'}[config.layout]}</span></div>
    {config.query && <p>关键词：<strong>{config.query}</strong></p>}
    {!!config.tags.length && <><p>{config.mode === 'all' ? '同时包含这些标签' : '包含任一标签'}</p><div className="saved-view-chips">{config.tags.map(tag => <span key={tag}># {tag}</span>)}</div></>}
  </div>;
}
export default function SavedViewDialog({ initial, current, library, libraryName, onClose, onChanged }) {
  const [record, setRecord] = useState(initial), [name, setName] = useState(initial?.name || ''), [config, setConfig] = useState(initial?.config || current);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [conflict, setConflict] = useState(false);
  async function act(work) {
    if (busy) return; setBusy(true); setError(''); setConflict(false);
    try { await work(); } catch (e) { setError(e.message); setConflict(e.status === 409 && !!record); } finally { setBusy(false); }
  }
  const save = () => act(async () => {
    const result = await send('/api/saved-views' + (record ? '/' + record.id : ''), { name, config, ...(record ? { version: record.version } : { collection_id: library }) }, record ? 'PATCH' : 'POST');
    onChanged(result, record ? '已更新筛选' : '已保存常用筛选'); onClose();
  });
  const remove = () => { if (confirm(`删除常用筛选「${record.name}」？知识库中的图片、视频和笔记都会保留。`)) void act(async () => { await send('/api/saved-views/' + record.id, { version: record.version }, 'DELETE'); onChanged(null, '已删除筛选，内容保留'); onClose(); }); };
  const latest = () => act(async () => { const result = await api('/api/saved-views/' + record.id); setRecord(result); setName(result.name); setConfig(result.config); });
  return <Dialog title={record ? '管理常用筛选' : '保存常用筛选'} className="small-dialog saved-view-dialog" onClose={() => !busy && onClose()}>
    <form className="feature-body" onSubmit={e => { e.preventDefault(); void save(); }}>
      <p className="muted">保存在「{libraryName}」</p>
      <label className="feature-field">筛选名称<input aria-label="筛选名称" maxLength={80} value={name} onChange={e => setName(e.target.value)} placeholder="例如：建筑参考 · 已收藏" disabled={busy} autoFocus required/></label>
      <Conditions config={config}/>
      {record && viewSignature(config) !== viewSignature(current) && <button type="button" disabled={busy} onClick={() => setConfig(current)}>使用当前页面的筛选条件</button>}
      {error && <p className="error" role="alert">{error}</p>}
      {conflict && <button type="button" disabled={busy} onClick={latest}>读取最新版本</button>}
      <div className="feature-actions">
        {record && <button type="button" className="danger" disabled={busy} onClick={remove}>删除筛选</button>}
        <button type="button" disabled={busy} onClick={onClose}>取消</button>
        <button type="submit" className="primary" disabled={busy || !name.trim()}>{busy ? '正在保存…' : record ? '保存修改' : '保存筛选'}</button>
      </div>
    </form>
  </Dialog>;
}
