import React, { useEffect, useRef, useState } from 'react';
import { Dialog } from './ui.jsx';
import { api, send } from './api.js';
import { HelpHint } from './HelpHint.jsx';

export default function GroupOrganizeDialog({ items, library, onClose, onDone }) {
  const [selection, setSelection] = useState(items.map(({ id, version }) => ({ id, version })));
  const [mode, setMode] = useState('create'), [title, setTitle] = useState(''), [whole, setWhole] = useState(false), [notes, setNotes] = useState('copy');
  const [target, setTarget] = useState(null), [query, setQuery] = useState(''), [offset, setOffset] = useState(0), [groups, setGroups] = useState({ groups: [], total: 0 });
  const [snapshot, setSnapshot] = useState(null), [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [groupError, setGroupError] = useState(''), [revision, setRevision] = useState(0);
  const forceRefresh = useRef(false);
  const [uncertain, setUncertain] = useState(false);
  const input = { items: selection, collection_id: library, mode, title, whole_groups: whole, target_id: target?.id || null, note_mode: notes };
  const signature = JSON.stringify(input), ready = !!snapshot && snapshot.signature === signature && !loading;
  useEffect(() => {
    if (mode !== 'append') return;
    const controller = new AbortController(); setGroupError('');
    const timer = setTimeout(() => api('/api/item-groups?' + new URLSearchParams({ collection: library || 'unfiled', q: query, offset }), { signal: controller.signal }).then(value => { if (!controller.signal.aborted) setGroups(value); }).catch(e => { if (!controller.signal.aborted) setGroupError(e.message); }), 150);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [mode, library, query, offset, revision]);
  useEffect(() => {
    setError(''); setSnapshot(null);
    if (mode === 'append' && !target) { setLoading(false); return; }
    const controller = new AbortController(); setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const value = await api('/api/item-groups/organize/preview', { method: 'POST', body: JSON.stringify({ ...JSON.parse(signature), refresh: forceRefresh.current }), signal: controller.signal });
        if (controller.signal.aborted) return;
        forceRefresh.current = false;
        if (JSON.stringify(value.input.items) !== JSON.stringify(selection)) setSelection(value.input.items);
        setSnapshot({ signature, value });
      } catch (e) { if (!controller.signal.aborted) setError(e.message); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }, 180);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [signature, revision]);
  const refresh = () => { forceRefresh.current = true; setRevision(n => n + 1); };
  async function save() {
    if (!ready || busy) return; setBusy(true); setError('');
    try { const result = await send('/api/item-groups/organize', { ...snapshot.value.input, revision: snapshot.value.revision, operation_id: snapshot.value.operation_id, prepared_at: snapshot.value.prepared_at, undo: true }); if (result.already_undone) throw Object.assign(Error('这次整理已撤销，请重新读取预览'), { status: 409 }); setUncertain(false); onDone(result); onClose(); }
    catch (e) { const unknown = !e.status || e.status >= 500; setUncertain(unknown); setError(unknown ? '尚未确认整理结果，请重试本次操作，不会重复建组。' : e.message); if (!unknown) setSnapshot(null); }
    finally { setBusy(false); }
  }
  const plan = ready ? snapshot.value : null;
  return <Dialog title="整理图片组" className="group-organize-dialog" onClose={() => !busy && onClose()}>
    <div className="group-organize-body">
      <fieldset className="group-organize-settings" disabled={busy || uncertain}>
        <label>整理方式<select aria-label="图片组整理方式" value={mode} onChange={e => setMode(e.target.value)}><option value="create">组成新图片组</option><option value="append">追加到已有图片组</option><option value="detach">拆为独立图片</option></select></label>
        {mode === 'create' && <label>新图片组名称（可选）<input aria-label="新图片组名称" maxLength={200} placeholder={plan?.title ? `默认：${plan.title}` : '留空使用封面图片标题'} value={title} onChange={e => setTitle(e.target.value)}/></label>}
        {mode === 'append' && <div className="group-target-picker"><label>查找目标组<input aria-label="搜索目标图片组" value={query} onChange={e => { setQuery(e.target.value); setOffset(0); }} placeholder="搜索当前知识库的素材组"/></label>
          <select aria-label="目标图片组" value={target?.id || ''} onChange={e => setTarget(groups.groups.find(g => g.id === e.target.value) || null)}>
            <option value="">选择素材组</option>{target && !groups.groups.some(g => g.id === target.id) && <option value={target.id}>{target.title} · {target.count} 张</option>}{groups.groups.map(g => <option key={g.id} value={g.id}>{g.title} · {g.count} 张</option>)}
          </select>
          {groups.total > 40 && <div className="group-target-pages"><button disabled={!offset} onClick={() => setOffset(n => Math.max(0,n-40))}>上一页</button><span>{offset/40+1} / {Math.ceil(groups.total/40)}</span><button disabled={offset+40>=groups.total} onClick={() => setOffset(n => n+40)}>下一页</button></div>}
          {groupError && <p className="error">{groupError}</p>}
        </div>}
        <div className="group-whole-row"><label className="group-whole"><input type="checkbox" checked={whole} onChange={e => setWhole(e.target.checked)}/>包含所选图片所在的整组</label><HelpHint label="整理范围">默认仅整理选中的图片。勾选后包含这些组中被筛选隐藏、或尚未加载的成员；每个原组保持内部顺序。追加时保留目标封面，新图片排在末尾。</HelpHint></div>
        {!!plan?.note_count && <label>笔记配图处理<select aria-label="笔记配图处理" value={notes} onChange={e => setNotes(e.target.value)}><option value="copy">保留原组，建立素材引用</option><option value="exclude">跳过笔记配图</option></select></label>}
      </fieldset>
      <section className="group-plan" aria-label="图片组整理预览">
        <div className="group-plan-heading"><strong>{mode === 'detach' ? '将拆为独立图片' : plan?.title || '整理后的图片组'}</strong><span>{plan ? `${plan.result_count} 张` : `${selection.length} 张已选`}</span></div>
        {loading && <p role="status">正在核对图片与分组…</p>}
        {!loading && !plan && !error && mode === 'append' && <p className="muted">选择目标组后显示预览</p>}
        {plan && <><p className="group-plan-summary">已选 {plan.selected_count} 张 · 实际范围 {plan.expanded_count} 张{plan.target_count ? ` · 目标原有 ${plan.target_count} 张` : ''}</p>
          <div className="group-plan-grid">{plan.items.map((item,index) => <div key={item.id}><img src={item.thumbnail_url} alt={item.title} loading="lazy"/><span>{index === 0 && plan.cover ? '封面' : index+1}</span></div>)}</div>
          {plan.result_count > plan.items.length && <p className="muted">预览前 60 张，操作包含全部 {plan.result_count} 张</p>}
          {!!plan.copied_count && <p className="group-copy-notice">{plan.copied_count} 张笔记配图将建立素材引用。原笔记和配图组保留，共享原文件。</p>}
          {!!plan.excluded_count && <p className="muted">跳过 {plan.excluded_count} 张笔记配图</p>}{!!plan.existing_count && <p className="muted">目标已包含 {plan.existing_count} 张配图引用，不重复添加</p>}
          {!plan.changed_count && <p className="muted">当前选择无需调整</p>}
        </>}
      </section>
    </div>
    <footer className="group-organize-footer">
      {error && <div className="group-organize-error"><p className="error" role="alert">{error}</p>{!uncertain && <button disabled={busy} onClick={refresh}>重新读取预览</button>}</div>}
      {groupError && !error && <button disabled={busy} onClick={refresh}>重新读取目标组</button>}
      <div className="feature-actions"><button disabled={busy} onClick={onClose}>取消</button><button className="primary" disabled={busy || !ready || !plan?.changed_count} onClick={save}>{busy ? '正在整理…' : uncertain ? '重试本次操作' : '确认整理'}</button></div>
    </footer>
  </Dialog>;
}
