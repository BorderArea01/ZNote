import { useEffect, useRef, useState } from 'react';
import { draftId, putDraft, getDraft, deleteDraft, listDrafts, emergencyDraft, recoverDrafts, getPosition, putPosition } from './draft-store.js';

export function useNoteDraft({ initial, item, fields, dirty, textarea, apply }) {
  const enabled = initial.kind === 'note' && !initial.deleted_at;
  const id = useRef(draftId()), latest = useRef(), chain = useRef(Promise.resolve()), replacing = useRef(null), timer = useRef();
  const pendingPosition = useRef(null), rememberedPosition = useRef(null), positionTimer = useRef(), readyRef = useRef(false), mounted = useRef(true);
  const durable = useRef('');
  const [ready, setReady] = useState(!enabled), [status, setStatus] = useState(''), [candidate, setCandidate] = useState(null);
  const position = () => textarea.current ? { start: textarea.current.selectionStart, end: textarea.current.selectionEnd, scroll: textarea.current.scrollTop } : rememberedPosition.current;
  latest.current = { id: id.current, note_id: item.id || null, library_id: item.collection_id || 'unfiled', base_version: item.version || 0, base: {title:item.title,content:item.content,tags:item.tags,collection_id:item.collection_id||null}, fields, dirty };
  function snapshot() { return { ...latest.current, position: position(), updated_at: Date.now(), stamp: draftId() }; }
  function enqueue(work) { const next = chain.current.catch(() => {}).then(work); chain.current = next; return next; }
  async function flush() {
    clearTimeout(timer.current);
    if (!enabled || !readyRef.current) return !enabled;
    const row = snapshot(), replace = replacing.current;
    try {
      await enqueue(async () => {
        if (row.dirty) await putDraft(row, replace);
        else { await deleteDraft(row.id); if (replace) await deleteDraft(replace.id, replace.stamp); }
        if (row.note_id && row.position) await putPosition(row.note_id, row.position);
      });
      if (replace === replacing.current) replacing.current = null;
      durable.current = JSON.stringify(row.fields);
      if (mounted.current) setStatus(row.dirty ? '草稿已保存在此浏览器' : '');
      return true;
    } catch { if (mounted.current) setStatus('草稿保存失败，请保存到知识库或导出正文'); return false; }
  }
  function resume(row) {
    replacing.current = row; pendingPosition.current = row.position;
    apply(row.fields); setCandidate(null); setStatus('已恢复本地草稿');
  }
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    (async () => {
      await recoverDrafts();
      const rows = initial.id ? await listDrafts('note', initial.id) : [];
      const row = initial._draft || (rows[0] && await getDraft(rows[0].id));
      const savedPosition = initial.id ? await getPosition(initial.id) : null;
      if (!active) return;
      pendingPosition.current = savedPosition;
      if (row) {
        const same = JSON.stringify(row.fields) === JSON.stringify(latest.current.fields);
        if (same) await deleteDraft(row.id, row.stamp);
        else if (row.base_version === (initial.version || 0) && !latest.current.dirty) resume(row);
        else setCandidate(row);
      }
    })().catch(() => { if (active) setStatus('无法读取本地草稿，仍可直接保存到知识库'); }).finally(() => { if (active) { readyRef.current = true; setReady(true); } });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!enabled || !ready) return;
    if (dirty) setStatus('正在保存草稿…');
    timer.current = setTimeout(flush, 400);
    return () => clearTimeout(timer.current);
  }, [ready, dirty, fields.title, fields.content, JSON.stringify(fields.tags), fields.collection_id, item.version]);
  useEffect(() => {
    mounted.current = true;
    if (!enabled) return;
    const persist = () => { if (readyRef.current && latest.current.dirty) emergencyDraft(snapshot()); void flush(); };
    const hidden = () => { if (document.visibilityState === 'hidden') persist(); };
    window.addEventListener('pagehide', persist); window.addEventListener('beforeunload', persist); document.addEventListener('visibilitychange', hidden);
    return () => { mounted.current = false; clearTimeout(timer.current); clearTimeout(positionTimer.current); window.removeEventListener('pagehide', persist); window.removeEventListener('beforeunload', persist); document.removeEventListener('visibilitychange', hidden); void flush(); };
  }, []);
  function restorePosition(node) {
    textarea.current = node;
    if (!node || !pendingPosition.current) return;
    const saved = pendingPosition.current; pendingPosition.current = null;
    requestAnimationFrame(() => { node.setSelectionRange(Math.min(saved.start || 0, node.value.length), Math.min(saved.end || 0, node.value.length)); node.scrollTop = saved.scroll || 0; });
  }
  function rememberPosition() { rememberedPosition.current = position(); clearTimeout(positionTimer.current); if (item.id && rememberedPosition.current) positionTimer.current = setTimeout(() => { void putPosition(item.id, rememberedPosition.current).catch(() => {}); }, 300); }
  async function discardCandidate() { try { await deleteDraft(candidate.id, candidate.stamp); setCandidate(null); setStatus(''); return true; } catch { setStatus('草稿删除失败，请重试'); return false; } }
  async function keepCurrent() {
    if (!latest.current.dirty) return true;
    const row = { ...snapshot(), id: draftId() };
    try { await enqueue(() => putDraft(row)); return true; }
    catch { setStatus('当前草稿备份失败，请先保存到知识库或导出正文'); return false; }
  }
  async function useCandidate() { if (!(await keepCurrent())) return false; resume(candidate); return true; }
  return { ready, status, candidate, flush, keepCurrent, restorePosition, rememberPosition, discardCandidate, useCandidate, isPersisted: () => durable.current === JSON.stringify(latest.current.fields) };
}
