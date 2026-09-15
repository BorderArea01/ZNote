import React,{useEffect,useRef,useState} from 'react';
import {api,send} from './api.js';
import {HelpHint} from './HelpHint.jsx';
export function CapturePanel({collections,currentCollection,onComplete,onOpen}){
  const [text,setText]=useState(''),[collection,setCollection]=useState(()=>localStorage.getItem('znote.capture.collection')??currentCollection??''),[jobs,setJobs]=useState([]),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const request=useRef(null),seen=useRef(new Set()),completed=useRef(onComplete);completed.current=onComplete;
  useEffect(()=>{let closed=false,timer;const poll=async()=>{try{const data=await api('/api/captures');if(closed)return;setJobs(data.jobs);for(const j of data.jobs)if(j.status==='completed'&&!seen.current.has(j.id)){seen.current.add(j.id);completed.current();}}catch(e){if(!closed)setError(e.message);}if(!closed)timer=setTimeout(poll,2500);};poll();return()=>{closed=true;clearTimeout(timer);};},[]);
  const valid=!collection||collections.some(c=>c.id===collection);
  async function submit(e){e.preventDefault();setBusy(true);setError('');try{
    const key=JSON.stringify([text,collection]);if(request.current?.key!==key)request.current={key,id:crypto.randomUUID()};
    await send('/api/captures',{text,collection_id:collection||null,request_id:'web:'+request.current.id});localStorage.setItem('znote.capture.collection',collection);setText('');request.current=null;
    setJobs((await api('/api/captures')).jobs);
  }catch(e){setError(e.message);}finally{setBusy(false);}}
  return <section className="capture-panel">
    <div className="inline-heading"><h3>分享链接入库</h3><HelpHint label="手机与网页采集">粘贴 App 分享文字或网页链接，由服务器保存正文、配图或视频。配图会下载到本地并成组，作者作为标签保存。平台要求登录或验证时可能无法取得完整内容。任务保留在服务器；重启中断的任务可手动重试。移除记录仅清理任务，不会删除已入库内容。</HelpHint></div>
    <form className="import-form" onSubmit={submit}>
      <label>分享内容<textarea aria-label="分享内容" rows={3} maxLength={16000} value={text} onChange={e=>setText(e.target.value)} placeholder="粘贴小红书、抖音分享文字，或浏览器网页链接" required/></label>
      <label>目标知识库<select value={collection} onChange={e=>setCollection(e.target.value)}><option value="">未分类</option>{!valid&&<option value={collection}>原知识库已不存在，请重新选择</option>}{collections.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <button className="primary" disabled={busy||!valid||!text.trim()}>{busy?'正在提交…':'采集到知识库'}</button>
    </form>
    {error&&<p className="error" role="alert">{error}</p>}
    <div className="import-jobs">{jobs.map(job=><article className="import-job" key={job.id}><strong>{job.title}</strong><p role="status">{job.message}</p><a href={job.source_url} target="_blank" rel="noreferrer">来源</a>{job.status==='completed'&&<button onClick={()=>onOpen(job.item_id)}>查看内容</button>}{job.status==='failed'&&<button onClick={async()=>{try{await send('/api/captures/'+job.id+'/retry',{});setJobs((await api('/api/captures')).jobs);}catch(e){setError(e.message);}}}>重试采集</button>}{['completed','failed'].includes(job.status)&&<button onClick={async()=>{try{await send('/api/captures/'+job.id,{},'DELETE');setJobs(old=>old.filter(j=>j.id!==job.id));}catch(e){setError(e.message);}}}>移除记录</button>}</article>)}</div>
  </section>;
}
