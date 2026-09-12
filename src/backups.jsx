import React, { useState, useEffect, useRef } from 'react';
import { api, send, bytes } from './api.js';
import { Dialog } from './ui.jsx';

export function BackupSettings() {
  const [status, setStatus] = useState(null), [error, setError] = useState(''), [working, setWorking] = useState('');
  const [preview, setPreview] = useState(null), [confirmed, setConfirmed] = useState(false);
  const picker = useRef();
  const dirty = useRef(false);
  const load = () => api('/api/backups').then(value => setStatus(previous => dirty.current && previous ? { ...value, enabled: previous.enabled, interval_hours: previous.interval_hours, keep: previous.keep } : value)).catch(e => setError(e.message));
  const editPolicy = patch => { dirty.current = true; setStatus(previous => ({ ...previous, ...patch })); };
  useEffect(() => { load(); const timer = setInterval(load, 15000); return () => clearInterval(timer); }, []);
  async function action(label, fn) {
    setWorking(label); setError('');
    try { await fn(); await load(); } catch (e) { setError(e.message); }
    finally { setWorking(''); }
  }
  async function upload(file) {
    if (!file) return;
    setConfirmed(false);
    await action('正在上传并校验备份…', async () => {
      const form = new FormData(); form.set('file', file);
      setPreview(await api('/api/backups/preview', { method: 'POST', body: form }));
    });
  }
  async function cancel() {
    if (working) return;
    await action('取消预览…', async () => { await api(`/api/backups/preview/${preview.id}`, { method: 'DELETE' }); setPreview(null); });
  }
  return <section className="backup-settings">
    <div className="settings-title"><h3>自动备份与恢复</h3></div>
    <p>完整备份包含知识库、笔记、原图和访问设置。备份保存在服务器 data/backups，也可以下载到其他设备保存。</p>
    {status && <>
      <div className="backup-policy">
        <label><input type="checkbox" checked={status.enabled} onChange={e => editPolicy({ enabled: e.target.checked })} /> 自动备份</label>
        <label>间隔（小时）<input aria-label="备份间隔小时" type="number" min="1" max="720" value={status.interval_hours} onChange={e => editPolicy({ interval_hours: Number(e.target.value) })} /></label>
        <label>保留版本数<input aria-label="备份保留版本数" type="number" min="1" max="100" value={status.keep} onChange={e => editPolicy({ keep: Number(e.target.value) })} /></label>
      </div>
      <div className="gallery-controls">
        <button disabled={!!working || status.busy} onClick={() => action('保存策略…', async () => { await send('/api/backups/policy', { enabled: status.enabled, interval_hours: status.interval_hours, keep: status.keep }, 'PATCH'); dirty.current = false; })}>保存备份设置</button>
        <button disabled={!!working || status.busy} onClick={() => action('正在生成完整备份…', () => send('/api/backups', {}))}>立即备份</button>
        <button disabled={!!working || status.busy} onClick={() => picker.current.click()}>上传备份并预览</button>
      </div>
      <p className="muted">最近成功：{status.last_success ? new Date(status.last_success).toLocaleString() : '尚无'}{status.busy ? ' · 后台任务进行中' : ''}</p>
      {status.last_error && <p role="alert" className="error">{status.last_error}</p>}
      <div className="backup-list">{status.backups.map(entry => <div className="backup-entry" key={entry.id}>
        <span>{new Date(entry.created_at).toLocaleString()}<small>{bytes(entry.bytes)}</small></span>
        <a href={`/api/backups/${entry.id}/download`}>下载完整备份</a>
      </div>)}</div>
      {!status.backups.length && <p className="muted">尚无备份。服务运行时会按策略自动生成。</p>}
    </>}
    <input type="file" ref={picker} hidden accept=".zip,application/zip" aria-label="上传完整备份" onChange={e => { upload(e.target.files[0]); e.target.value = ''; }} />
    {working && <p role="status">{working}</p>}{error && <p className="error" role="alert">{error}</p>}
    {preview && <Dialog className="small-dialog" title="恢复备份预览" onClose={cancel}>
      <div className="feature-body">
        <p>校验通过：{preview.counts.collections} 个知识库、{preview.counts.items} 项内容、{preview.unique_images} 份原图、{preview.unique_videos || 0} 个视频（{bytes(preview.original_bytes)}）。</p>
        <p className="muted">{preview.collections.join(' · ') || '未分类内容'}</p>
        <p>恢复会替换当前内容和访问设置。开始前会自动保存当前状态的完整备份；恢复完成后，使用备份中的密码重新登录。</p>
        <label className="restore-confirm"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} disabled={!!working} /> 我已确认要恢复这个备份</label>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="feature-actions"><button onClick={cancel} disabled={!!working}>取消</button><button className="primary" disabled={!confirmed || !!working} onClick={() => action('正在恢复，请保持页面打开…', async () => {
          await send(`/api/backups/restore/${preview.id}`, { confirm: 'RESTORE' }); window.location.reload();
        })}>{working || '恢复这个备份'}</button></div>
      </div>
    </Dialog>}
  </section>;
}
