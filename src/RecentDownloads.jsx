import React,{useEffect,useRef,useState} from 'react';
import {Download,RefreshCw,RotateCcw,ExternalLink,Loader2,CheckCircle2,AlertCircle} from 'lucide-react';
import {useTaskStore,useTaskSnapshot} from './Tasks.jsx';
import {downloadJobs,filterDownloads,downloadFailed,retryDownloads,downloadSource,retryableDownload} from './download-jobs.js';
import {api} from './api.js';
import {Dialog} from './ui.jsx';
import {HelpHint} from './HelpHint.jsx';
import './recent-downloads.css';

export function RecentDownloadsButton({collection,onClick}) {
  const {remote}=useTaskSnapshot();
  const failed=downloadJobs(remote).some(j=>downloadFailed(j)&&(j.collection_id||'unfiled')===(collection||'unfiled'));
  return <button className="task-button recent-downloads-button" aria-label="最近下载" onClick={onClick}><Download size={18}/><span>最近下载</span>{failed&&<i className="task-dot"/>}</button>;
}
const stateName=job=>job.retried_as?'已重新提交':job.bgm_status==='failed'&&job.status==='completed'?'配乐失败':({queued:'排队中',running:'下载中',saving:'入库中',failed:'下载失败',completed:'已入库',cancelled:'已取消'})[job.status]||job.status;
const time=value=>{const d=new Date(value);return Number.isFinite(d.getTime())?d.toLocaleString():'时间未知';};

export function RecentDownloads({collection,collections,onClose,onOpen}) {
  const store=useTaskStore(),{remote}=useTaskSnapshot(),mounted=useRef(true),lock=useRef(false);
  const [scope,setScope]=useState(collection||'unfiled'),[days,setDays]=useState('7'),[status,setStatus]=useState('all'),[page,setPage]=useState(0),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
  useEffect(()=>{mounted.current=true;store.watchers++;store.refreshRemote();return()=>{mounted.current=false;store.watchers--}},[store]);
  const scoped=filterDownloads(downloadJobs(remote),{scope,days}),filtered=scoped.filter(j=>status==='all'||j.state===status),failed=filtered.filter(downloadFailed),pages=Math.max(1,Math.ceil(filtered.length/30)),currentPage=Math.min(page,pages-1),visible=filtered.slice(currentPage*30,currentPage*30+30);
  const library=id=>id?collections.find(c=>c.id===id)?.name||'已删除的知识库':'未分类';
  const choose=setter=>e=>{setter(e.target.value);setPage(0);setMessage('');setError('');};
  async function retry(rows) {
    if(lock.current)return;lock.current=true;setBusy(true);setError('');setMessage('正在提交重试…');
    try {
      const result=await retryDownloads(rows,{request:api,shouldContinue:()=>mounted.current,onProgress:r=>{if(mounted.current)setMessage(`已提交 ${r.submitted} 条重试 · 剩余 ${r.remaining} 条`);}});
      if(mounted.current){setMessage(`已提交 ${result.submitted} 条重试${result.skipped?`，跳过 ${result.skipped} 条已更新记录`:''}${result.remaining+result.errors.length?`；${result.remaining+result.errors.length} 条待处理`:''}`);if(result.errors.length)setError(`重试提交遇到问题：${result.errors[0].message}`);}
    } catch(e){if(mounted.current)setError(e.message);}
    finally{lock.current=false;store.refreshRemote();if(mounted.current)setBusy(false);}
  }
  return <Dialog title="最近下载" className="recent-downloads-dialog" onClose={onClose}>
    <div className="downloads-filters">
      <select aria-label="下载知识库" value={scope} onChange={choose(setScope)} disabled={busy}><option value="all">全部知识库</option><option value="unfiled">未分类</option>{collections.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select>
      <select aria-label="下载时间范围" value={days} onChange={choose(setDays)} disabled={busy}><option value="1">最近 24 小时</option><option value="7">最近 7 天</option><option value="30">最近 30 天</option><option value="all">全部记录</option></select>
      <button aria-label="刷新下载记录" disabled={busy} onClick={()=>store.refreshRemote()}><RefreshCw size={16}/></button>
      <HelpHint label="最近下载">显示当前服务器保留的分享链接采集、图组和视频下载记录，不包含仅下载到浏览器本地的文件。分享采集记录保存在服务器，视频导入记录在服务重启后清空；清理记录不删除内容。重试沿用原任务与目标库，跳过已保存的成员；配乐失败只重试配乐。批量重试作用于当前筛选的全部失败记录，队列满时保留未提交项；关闭窗口停止后续提交，已提交任务继续执行。平台登录或验证限制仍可能导致重试失败。</HelpHint>
    </div>
    <div className="downloads-statebar"><div className="downloads-states" aria-label="下载状态筛选">{[['all','全部'],['active','进行中'],['failed','失败'],['completed','已完成']].map(([value,label])=><button key={value} aria-pressed={status===value} disabled={busy} onClick={()=>{setStatus(value);setPage(0);setMessage('');setError('');}}>{label}<b>{value==='all'?scoped.length:scoped.filter(j=>j.state===value).length}</b></button>)}</div>
      <button className="downloads-batch" disabled={!failed.length||busy||!remote.loaded||!!remote.downloadError} onClick={()=>retry(failed)}>{busy?<Loader2 className="spin" size={15}/>:<RotateCcw size={15}/>}重试失败{failed.length?`（${failed.length}）`:''}</button>
    </div>
    {(error||remote.downloadError)&&<p className="downloads-feedback error" role="alert">{error||remote.downloadError}</p>}
    {message&&<p className="downloads-feedback" role="status">{message}</p>}
    <div className="downloads-list">{!visible.length&&<div className="downloads-empty"><Download size={30}/><p>{!remote.loaded?'正在读取下载记录…':remote.downloadError?'暂时无法读取，请刷新重试':status==='failed'?'当前范围没有下载失败记录':'当前范围没有下载记录'}</p></div>}{visible.map(job=>{const source=downloadSource(job.source_url),failed=downloadFailed(job),details=[job.message,job.bgm_error].filter(Boolean).join('；');return <article className={'download-row'+(failed?' is-failed':'')} data-download-id={job.id} key={job.id}>
      <div className="download-row-heading"><strong title={job.title}>{job.title}</strong><span className={'download-state state-'+job.state}>{job.state==='active'?<Loader2 className="spin" size={13}/>:failed?<AlertCircle size={13}/>:job.state==='completed'?<CheckCircle2 size={13}/>:null}{stateName(job)}</span></div>
      <div className="download-meta"><span>{job.type==='capture'?'作品采集':'视频下载'} · {library(job.collection_id)}</span><time dateTime={job.created_at}>{time(job.created_at)}</time></div>
      {details.length>180?<details className="download-message"><summary>{details.slice(0,140)}…</summary><p>{details}</p></details>:<p className="download-message">{details||stateName(job)}</p>}
      <div className="download-row-footer">{source&&<a href={source.href} target="_blank" rel="noreferrer"><ExternalLink size={13}/>{source.host}</a>}<div>{job.item_id&&<button disabled={busy} onClick={()=>onOpen(job.item_id)}>查看入库内容</button>}{retryableDownload(job)&&<button disabled={busy||!!remote.downloadError} onClick={()=>retry([job])}><RotateCcw size={13}/>{job.bgm_status==='failed'&&job.status==='completed'?'重试配乐':'重新尝试'}</button>}</div></div>
    </article>})}</div>
    <footer className="downloads-footer"><span>{filtered.length} 条记录</span>{pages>1&&<nav aria-label="下载记录分页"><button disabled={!currentPage} onClick={()=>setPage(currentPage-1)}>上一页</button><span>{currentPage+1} / {pages}</span><button disabled={currentPage>=pages-1} onClick={()=>setPage(currentPage+1)}>下一页</button></nav>}</footer>
  </Dialog>;
}
