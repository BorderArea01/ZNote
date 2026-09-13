import React, { useEffect, useState } from 'react';
import { History, Undo2, X } from 'lucide-react';
import { api, send } from './api.js';
import { Dialog, IconButton } from './ui.jsx';

export function UndoCenter({ receipt, open, onClose, blocked, onUndone, onDismiss }) {
  const [actions, setActions] = useState([]), [busy, setBusy] = useState(null), [error, setError] = useState('');
  const [dismissed, setDismissed] = useState(null);
  useEffect(() => {
    if (!receipt || blocked || open) return;
    const timer = setTimeout(onDismiss, 10000);
    return () => clearTimeout(timer);
  }, [receipt?.id, blocked, open]);
  useEffect(() => {
    let active = true;
    api('/api/undo').then(result => { if (active) { setActions(result.actions); setError(''); } }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [receipt?.id, open]);
  const latest = receipt && receipt.expires_at > new Date().toISOString() && receipt.id !== dismissed && !actions.find(a => a.id === receipt.id)?.undone_at ? receipt : null;
  async function undo(action) {
    if (busy || blocked) return;
    setBusy(action.id); setError('');
    try {
      const result = await send('/api/undo/' + action.id, {});
      setActions(old => old.map(a => a.id === action.id ? { ...a, undone_at: result.undone_at } : a));
      setDismissed(action.id); onUndone(action);
    } catch (e) { setError(e.message); }
    finally { setBusy(null); }
  }
  return <>
    {latest && !blocked && !open && <div className="undo-notice" role="status"><Undo2 size={17}/><span>{latest.label}已完成</span><button disabled={!!busy} onClick={() => undo(latest)}>{busy ? '正在撤销…' : '撤销'}</button><IconButton label="收起撤销提示" onClick={() => { setDismissed(latest.id); setError(''); onDismiss(); }}><X size={15}/></IconButton>{error && <p role="alert">{error}</p>}</div>}
    {open && <Dialog title="最近操作" className="small-dialog undo-dialog" onClose={() => !busy && onClose()}>
      <div className="feature-body"><p className="muted">本次登录最近 24 小时内的操作，最多保留 50 条。永久删除不能撤销。</p>
        {error && <p role="alert" className="error">{error}</p>}
        {!actions.length && !error && <div className="undo-empty"><History size={28}/><p>暂无可撤销的操作</p></div>}
        <div className="undo-list">{actions.map(action => <div className="undo-row" key={action.id}><div><strong>{action.label}</strong><small>{new Date(action.created_at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · 影响 {action.count} 条内容及关联记录</small></div><button disabled={!!busy || !!action.undone_at || blocked} onClick={() => undo(action)}>{action.undone_at ? '已撤销' : busy === action.id ? '处理中…' : '撤销'}</button></div>)}</div>
      </div>
    </Dialog>}
  </>;
}
