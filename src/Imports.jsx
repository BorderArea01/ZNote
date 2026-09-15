import React, { useEffect, useRef, useState } from 'react';
import { Dialog } from './ui.jsx';
import { HelpHint } from './HelpHint.jsx';
import { api, send } from './api.js';
import './imports.css';
import {useTaskStore,useTaskSnapshot} from './Tasks.jsx';
import {CapturePanel} from './CapturePanel.jsx';

export function ImportsDialog({ collections, currentCollection, onClose, onComplete, onOpen }) {
  const taskStore=useTaskStore(),{remote}=useTaskSnapshot(),jobs=remote.imports;
  const [url, setUrl] = useState(''), [collection, setCollection] = useState(currentCollection || ''), [tags, setTags] = useState('');
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const seen = useRef(new Set()), complete = useRef(onComplete); complete.current = onComplete;
  useEffect(()=>{taskStore.watchers++;taskStore.refreshRemote();return()=>{taskStore.watchers--}},[taskStore]);
  useEffect(()=>{for(const job of jobs)if(job.status==='completed'&&!seen.current.has(job.id)){seen.current.add(job.id);complete.current();}},[jobs]);
  async function submit(e) {
    e.preventDefault(); setError(''); setBusy(true);
    try { await send('/api/imports', { url: url.trim(), collection_id: collection || null, tags: tags.split(/[,，]/).map(t => t.trim()).filter(Boolean) }); taskStore.refreshRemote(); setUrl(''); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  return <Dialog title="网络采集" onClose={onClose} className="import-dialog">
    <div className="import-body">
      <CapturePanel collections={collections} currentCollection={currentCollection} onComplete={onComplete} onOpen={onOpen}/>
      <details><summary>视频专用采集与旧任务</summary>
      <div className="inline-heading"><h3>保存网页视频</h3><HelpHint label="网络视频采集">粘贴哔哩哔哩、抖音、小红书或 X 的单条视频链接，来源自动写进备注。单条最多 500 MB，音视频合并不重新编码。需要登录或验证的资源可能无法获取；图片可用浏览器扩展采集。</HelpHint></div>
      <form onSubmit={submit} className="import-form">
        <label>视频页面链接<input required type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://www.bilibili.com/video/…" /></label>
        <label>存入知识库<select value={collection} onChange={e => setCollection(e.target.value)}><option value="">未分类</option>{collections.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label>标签（用逗号分隔）<input value={tags} onChange={e => setTags(e.target.value)} placeholder="参考，灵感" /></label>
        <button className="primary" disabled={busy || !url.trim()}>{busy ? '正在提交…' : '开始采集'}</button>
      </form>
      {(error||remote.error) && <p role="alert" className="error">{error||remote.error}</p>}
      <div className="inline-heading"><h3>采集记录</h3><HelpHint label="采集任务">关闭窗口后继续处理；服务重启会清空记录并中止未完成任务，已入库内容保留。</HelpHint></div>
      {!jobs.length && <p className="muted">还没有采集任务</p>}
      <div className="import-jobs">{jobs.map(job => <article key={job.id} className="import-job">
        <a href={job.source_url} target="_blank" rel="noreferrer">{job.source_url}</a>
        <p role="status">{job.message}</p>
        {job.status === 'completed' ? <button onClick={() => onOpen(job.item_id)}>打开视频</button> : ['queued','running'].includes(job.status) ? <button onClick={async () => { try { await send('/api/imports/' + job.id, {}, 'DELETE'); } catch (e) { setError(e.message); } }}>取消采集</button> : ['failed','cancelled'].includes(job.status) ? <button onClick={() => setUrl(job.source_url)}>重新填写此链接</button> : null}
      </article>)}</div>
      </details>
    </div>
  </Dialog>;
}
