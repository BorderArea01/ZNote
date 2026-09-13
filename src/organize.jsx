import React, { useState } from 'react';
import { Dialog } from './ui.jsx';
import { send } from './api.js';

export function OrganizeDialog({ items, collections, onClose, onDone, copy = false }) {
  const [collection, setCollection] = useState('');
  const [favorite, setFavorite] = useState('keep');
  const [move, setMove] = useState(copy);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save() {
    setBusy(true); setError('');
    try {
      let result;
      if (copy) {
        await send(`/api/items/${items[0].id}/copy`, { collection_id: collection || null });
      } else {
        result = await send('/api/items/batch-organize', {
          undo: true,
          items: items.map(({ id, version }) => ({ id, version })),
          ...(move ? { collection_id: collection || null } : {}),
          ...(favorite !== 'keep' ? { favorite: favorite === 'yes' } : {}),
        });
      }
      onDone(result); onClose();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  return <Dialog className="small-dialog" title={copy ? '复用到其他知识库' : `批量整理 ${items.length} 项内容`} onClose={() => !busy && onClose()}>
    <div className="feature-body">
      {copy ? <p className="muted">原图只保存一份。新条目拥有独立标题、说明、标签与收藏状态。</p> :
        <label><input type="checkbox" checked={move} onChange={e => setMove(e.target.checked)} /> 移动到知识库</label>}
      <select aria-label="整理目标知识库" disabled={!move || busy} value={collection} onChange={e => setCollection(e.target.value)}>
        <option value="">未分类</option>{collections.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      {!copy && <label className="feature-field">收藏状态<select aria-label="批量收藏状态" value={favorite} onChange={e => setFavorite(e.target.value)} disabled={busy}>
        <option value="keep">保持原状态</option><option value="yes">全部收藏</option><option value="no">全部取消收藏</option>
      </select></label>}
      {error && <p role="alert" className="error">{error}</p>}
      <div className="feature-actions"><button onClick={onClose} disabled={busy}>取消</button><button className="primary" disabled={busy || (!move && favorite === 'keep')} onClick={save}>{busy ? '正在整理…' : '确认整理'}</button></div>
    </div>
  </Dialog>;
}
