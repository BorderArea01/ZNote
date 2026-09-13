import React, { useEffect, useState } from 'react';
import { FilePenLine, Trash2 } from 'lucide-react';
import { Dialog, IconButton } from './ui.jsx';
import { listDrafts, getDraft, deleteDraft, recoverDrafts } from './draft-store.js';

export function DraftsDialog({ library, collections, onClose, onOpen }) {
  const [rows, setRows] = useState([]), [error, setError] = useState(''), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true);
  const readRows = async () => library ? listDrafts('library', library) : (await listDrafts()).filter(row => row.library_id === 'unfiled' || !collections.some(c => c.id === row.library_id));
  useEffect(() => { let active = true; recoverDrafts().then(readRows).then(rows => { if (active) setRows(rows); }).catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, [library, collections]);
  async function open(row) {
    setBusy(true); setError('');
    try { const draft = await getDraft(row.id); if (!draft) throw Error('这份草稿已在其他页面处理'); await onOpen(draft); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function remove(row) {
    if (!confirm('删除这份本地草稿？已保存的笔记不会受影响。')) return;
    try { await deleteDraft(row.id, row.stamp); setRows(await readRows()); } catch (e) { setError(e.message); }
  }
  return <Dialog title="本地草稿" className="small-dialog" onClose={() => !busy && onClose()}><div className="feature-body">
    <p className="muted">当前知识库在此浏览器中尚未提交的笔记。</p>
    {error && <p className="error" role="alert">{error}</p>}
    <div className="undo-list">{rows.map(row => <div className="undo-row" key={row.id}><FilePenLine size={18}/><div><strong>{row.title}</strong><small>{new Date(row.updated_at).toLocaleString('zh-CN')} · {row.length} 字</small></div><button disabled={busy} onClick={() => open(row)}>继续编辑</button><IconButton label={`删除草稿 ${row.title}`} disabled={busy} onClick={() => remove(row)}><Trash2 size={15}/></IconButton></div>)}</div>
    {!rows.length && <p className="muted">{loading ? '正在读取…' : '暂无未提交的草稿'}</p>}
  </div></Dialog>;
}

export function DraftConflict({ draft, current, onUse, onDiscard }) {
  const [review, setReview] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => { setReview(false); setError(''); }, [draft?.id]);
  async function act(operation) {
    if (busy) return;
    setBusy(true); setError('');
    try { if (await operation()) setReview(false); else setError('操作未完成，草稿仍保留，请重试。'); }
    catch { setError('操作未完成，草稿仍保留，请重试。'); }
    finally { setBusy(false); }
  }
  if (!draft) return null;
  return <><div className="draft-conflict" role="status"><span>发现本地草稿，当前笔记已有其他修改。</span><button onClick={() => setReview(true)}>对照草稿</button></div>
    {review && <Dialog title="对照本地草稿" className="draft-compare" onClose={() => !busy && setReview(false)}><div className="draft-compare-body"><p>选择草稿后可继续编辑，点击保存才会替换当前笔记；保存时仍会检查版本冲突。</p><div className="draft-columns"><label>知识库当前内容<strong>{current.title}</strong><textarea aria-label="知识库当前正文" readOnly value={current.content}/></label><label>本地草稿<strong>{draft.fields.title}</strong><textarea aria-label="本地草稿正文" readOnly value={draft.fields.content}/></label></div>{error && <p className="error" role="alert">{error}</p>}<div className="feature-actions"><button disabled={busy} onClick={() => act(onDiscard)}>丢弃这份草稿</button><button disabled={busy} className="primary" onClick={() => act(onUse)}>用草稿继续编辑</button></div></div></Dialog>}
  </>;
}
