import React,{useEffect,useRef,useState} from 'react';
import {History,ArrowRight,RefreshCw} from 'lucide-react';
import {ReadingSync} from './reading-sync.js';
import {Dialog} from './ui.jsx';
import {HelpHint} from './HelpHint.jsx';

export function useReadingProgress(library,enabled,revision) {
  const client=useRef(null),[state,setState]=useState({data:null,status:'loading',error:''});
  useEffect(()=>{
    if(!enabled){client.current=null;setState({data:null,status:'loading',error:''});return;}
    const sync=new ReadingSync(library,state=>setState({...state,library}));client.current=sync;setState({...sync.state,library});sync.load();
    const hide=()=>{if(!['error','conflict'].includes(sync.state.status))sync.flush();};const leave=()=>{if(document.hidden)hide();};
    const focus=()=>{if(!sync.busy&&!sync.active&&!sync.next)sync.load();};
    document.addEventListener('visibilitychange',leave);window.addEventListener('pagehide',hide);window.addEventListener('focus',focus);
    return()=>{sync.dispose();document.removeEventListener('visibilitychange',leave);window.removeEventListener('pagehide',hide);window.removeEventListener('focus',focus);};
  },[library,enabled]);
  useEffect(()=>{if(client.current&&!client.current.busy)client.current.load();},[revision]);
  return {...(state.library===library?state:{data:null,status:'loading',error:''}),record:id=>client.current?.record(id),cancelItems:ids=>client.current?.cancelItems(ids),leave:()=>{const sync=client.current;if(sync&&!['error','conflict'].includes(sync.state.status))sync.flush();},retry:()=>client.current?.retry(),replace:()=>client.current?.replaceWithLatest(),discard:()=>client.current?.discard(),reload:()=>client.current?.load(),clear:()=>client.current?.clear(),hasPending:!!(client.current?.active||client.current?.next),clearing:client.current?.active?.method==='DELETE'&&!client.current?.next};
}
export function ReadingProgress({progress,onOpen,disabled,open,setOpen}) {
  const entries=progress.data?.entries||[],first=entries[0];
  const pending=['error','conflict','pending'].includes(progress.status);
  const feedback=<>{pending&&<div className="reading-feedback" role="status"><span>{progress.error||'有浏览位置尚未同步'}</span><button onClick={progress.status==='conflict'?progress.replace:progress.retry}>{progress.status==='conflict'?(progress.clearing?'重新确认清除':'同步本页位置'):progress.hasPending?'重试同步':'重试读取'}</button>{progress.hasPending&&<button onClick={progress.discard}>放弃本次同步</button>}</div>}{progress.localError&&<p className="muted">{progress.localError}</p>}</>;
  return <>
    <div className="reading-resume">
      {first&&<button className="reading-resume-main" disabled={disabled} onClick={()=>onOpen(first)}><img src={first.thumbnail_url} alt="" loading="lazy"/><span><small>继续查看</small><strong>{first.title}</strong></span><span className="reading-page">{first.position} / {first.total}</span><ArrowRight size={16}/></button>}
      <button className="text-button" onClick={()=>{setOpen(true);progress.reload()}}>{progress.status==='saving'?<RefreshCw size={15} className="spin" aria-label="同步中"/>:<History size={15}/>}浏览记录</button>
    </div>
    {!open&&(pending||progress.localError)&&feedback}
    {open&&<Dialog title="浏览记录" className="reading-dialog" onClose={()=>setOpen(false)}><div className="reading-history-body"><div className="reading-history-heading"><span>当前知识库 · 最近 {entries.length} 组 / 张</span><HelpHint label="继续浏览">同一图片组保留最后查看的位置，最多 20 条；其他设备登录同一服务可以继续查看。按图片 ID 定位，排序变化后显示当前页码。删除或移动后的无效记录不显示，清除记录不会删除内容。</HelpHint><button className="text-button" onClick={progress.reload} disabled={progress.status==='saving'} aria-label="刷新浏览记录"><RefreshCw size={15}/></button></div>
      {feedback}{!entries.length&&<p className="reading-empty">查看图片后，会在这里留下继续浏览的入口。</p>}
      {entries.map(row=><button className="reading-history-row" key={row.item_id} disabled={disabled} onClick={()=>{setOpen(false);onOpen(row)}}><img src={row.thumbnail_url} alt="" loading="lazy"/><span><strong>{row.title}</strong><small>{new Date(row.viewed_at).toLocaleString('zh-CN')} · 第 {row.position} / {row.total} 张</small></span><ArrowRight size={16}/></button>)}
      </div><footer className="feature-actions"><button disabled={!entries.length||progress.status==='saving'} onClick={progress.clear}>清除浏览记录</button><button className="primary" onClick={()=>setOpen(false)}>完成</button></footer></Dialog>}
  </>;
}
