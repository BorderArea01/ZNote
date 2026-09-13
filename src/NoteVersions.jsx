import React, { useEffect, useState } from 'react';
import { Dialog } from './ui.jsx';
import { api } from './api.js';

export default function NoteVersions({ item, onClose, onUse }) {
  const [versions, setVersions] = useState([]), [selected, setSelected] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true);
  useEffect(() => { let active = true; api('/api/items/' + item.id + '/versions').then(result => { if (active) setVersions(result.versions); }).catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, [item.id]);
  async function choose(id) {
    setBusy(true); setError('');
    try { setSelected(await api('/api/items/' + item.id + '/versions/' + id)); } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  return <Dialog title="笔记版本记录" className="draft-compare" onClose={() => !busy && onClose()}><div className="draft-compare-body">
    <p>最近 50 个已保存版本。使用旧版本会载入编辑器，确认保存后才更新笔记；配图按当前状态检查。</p>
    <select aria-label="选择笔记版本" value={selected?.id || ''} onChange={e => choose(e.target.value)} disabled={busy}><option value="" disabled>选择一个版本查看</option>{versions.map(v => <option key={v.id} value={v.id}>v{v.version} · {new Date(v.saved_at).toLocaleString('zh-CN')} · {v.title}</option>)}</select>
    {error && <p className="error" role="alert">{error}</p>}
    {selected && <><div className="draft-columns"><label>当前正文<strong>{item.title}</strong><textarea aria-label="当前版本正文" readOnly value={item.content}/></label><label>历史正文<strong>{selected.title}</strong><textarea aria-label="历史版本正文" readOnly value={selected.content}/></label></div><div className="feature-actions"><button className="primary" disabled={busy} onClick={async () => { setBusy(true); try { if (await onUse(selected)) onClose(); } finally { setBusy(false); } }}>用此版本继续编辑</button></div></>}
    {!versions.length && !error && <p className="muted">{loading ? '正在读取版本…' : '暂无版本记录'}</p>}
  </div></Dialog>;
}
