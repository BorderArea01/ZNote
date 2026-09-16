import { HelpHint } from './HelpHint.jsx';
import React, { useState, useEffect, useRef } from 'react';
import { api, send, bytes } from './api.js';
import { Dialog } from './ui.jsx';
import {startExport,useTaskStore} from './Tasks.jsx';

export function BackupSettings() {
  const taskStore=useTaskStore();
  const [status, setStatus] = useState(null), [error, setError] = useState(''), [working, setWorking] = useState('');
  const [preview, setPreview] = useState(null), [confirmed, setConfirmed] = useState(false), [removeTarget,setRemoveTarget]=useState(null);
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
  async function previewSaved(entry) {
    setConfirmed(false);
    await action('正在校验恢复快照…', async()=>setPreview(await send(`/api/backups/${entry.id}/preview`,{})));
  }
  return <section className="backup-settings">
    <div className="settings-title"><h3>恢复快照与迁移</h3><HelpHint label="恢复与迁移的区别">恢复快照保存在服务器，用于快速回到之前状态；同一磁盘会复用不可变媒体文件，通常只增加数据库大小。迁移备份在点击时直接生成 ZIP 并交给浏览器下载，服务器不长期保存整包。</HelpHint></div>
    {status && <>
      <div className="backup-policy">
        <label><input type="checkbox" checked={status.enabled} onChange={e => editPolicy({ enabled: e.target.checked })} /> 自动恢复快照</label>
        <label>间隔（小时）<input aria-label="恢复快照间隔小时" type="number" min="1" max="720" value={status.interval_hours} onChange={e => editPolicy({ interval_hours: Number(e.target.value) })} /></label>
        <label>保留快照数<input aria-label="恢复快照保留版本数" type="number" min="1" max="100" value={status.keep} onChange={e => editPolicy({ keep: Number(e.target.value) })} /></label>
      </div>
      <div className="gallery-controls">
        <button disabled={!!working || status.busy} onClick={() => action('保存策略…', async () => { await send('/api/backups/policy', { enabled: status.enabled, interval_hours: status.interval_hours, keep: status.keep }, 'PATCH'); dirty.current = false; })}>保存快照设置</button>
        <button disabled={!!working || status.busy} onClick={() => action('正在创建恢复快照…', async () => {const [ticket]=taskStore.enqueue([{type:'backup',lane:'backup',title:'恢复快照',global:true,cancellable:false,start_message:'服务器正在创建恢复快照',done_message:'恢复快照已生成',run:()=>send('/api/backups',{})}]);const result=await ticket.promise;if(!result.ok)throw result.error;})}>立即创建快照</button>
        <button disabled={!!working || status.busy} onClick={() => action('正在准备迁移下载…', async()=>startExport(taskStore,{mode:'backup',include_trash:'true'}))}>导出迁移 ZIP</button>
        <button disabled={!!working || status.busy} onClick={() => picker.current.click()}>导入迁移 ZIP</button>
      </div>
      <p className="muted">最近快照：{status.last_success ? new Date(status.last_success).toLocaleString() : '尚无'} · 实际占用 {bytes(status.stored_bytes||0)}{status.logical_bytes>status.stored_bytes?`，可恢复内容 ${bytes(status.logical_bytes)}`:''}{status.busy ? ' · 后台任务进行中' : ''}</p>
      {status.last_error && <p role="alert" className="error">{status.last_error}</p>}
      <div className="backup-list">{status.backups.map(entry => <div className="backup-entry" key={entry.id}>
        <span>{new Date(entry.created_at).toLocaleString()}<small>{entry.format==='snapshot'?`恢复快照 · 新增占用 ${bytes(entry.stored_bytes)} · 可恢复 ${bytes(entry.logical_bytes)}`:`旧版完整 ZIP · ${bytes(entry.stored_bytes)}`}</small></span>
        {entry.format==='snapshot'&&<button disabled={!!working||status.busy} onClick={()=>previewSaved(entry)}>检查并恢复</button>}
        <a href={`/api/backups/${entry.id}/download`}>下载迁移 ZIP</a>
        <button disabled={!!working||status.busy} onClick={()=>setRemoveTarget(entry)}>删除</button>
      </div>)}</div>
      {!status.backups.length && <p className="muted">尚无恢复快照。服务运行时会按策略自动生成。</p>}
    </>}
    <input type="file" ref={picker} hidden accept=".zip,application/zip" aria-label="导入迁移备份 ZIP" onChange={e => { upload(e.target.files[0]); e.target.value = ''; }} />
    {working && <p role="status">{working}</p>}{error && <p className="error" role="alert">{error}</p>}
    {preview && <Dialog className="small-dialog" title="恢复备份预览" onClose={cancel}>
      <div className="feature-body">
        <p>校验通过：{preview.counts.collections} 个知识库、{preview.counts.items} 项内容、{preview.unique_images} 份原图、{preview.unique_videos || 0} 个视频（{bytes(preview.original_bytes)}）。</p>
        <p className="muted">{preview.collections.join(' · ') || '未分类内容'}</p>
        <p>恢复会替换当前内容和访问设置。开始前会自动创建当前状态的恢复快照；恢复完成后，使用备份中的密码重新登录。</p>
        <label className="restore-confirm"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} disabled={!!working} /> 我已确认要恢复这个备份</label>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="feature-actions"><button onClick={cancel} disabled={!!working}>取消</button><button className="primary" disabled={!confirmed || !!working} onClick={() => action('正在恢复，请保持页面打开…', async () => {
          await send(`/api/backups/restore/${preview.id}`, { confirm: 'RESTORE' }); window.location.reload();
        })}>{working || '恢复这个备份'}</button></div>
      </div>
    </Dialog>}
    {removeTarget&&<Dialog className="small-dialog" title="删除恢复记录" onClose={()=>!working&&setRemoveTarget(null)}><div className="feature-body"><p>删除 {new Date(removeTarget.created_at).toLocaleString()} 的{removeTarget.format==='snapshot'?'恢复快照':'旧版完整 ZIP'}，之后不能再用它恢复。</p><div className="feature-actions"><button disabled={!!working} onClick={()=>setRemoveTarget(null)}>取消</button><button className="danger" disabled={!!working} onClick={()=>action('正在删除…',async()=>{await api(`/api/backups/${removeTarget.id}`,{method:'DELETE'});setRemoveTarget(null)})}>确认删除</button></div></div></Dialog>}
  </section>;
}
