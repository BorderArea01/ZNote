import React,{useEffect,useRef,useState} from 'react';
import {History,RefreshCw} from 'lucide-react';
import {Dialog} from './ui.jsx';
import {HelpHint} from './HelpHint.jsx';
import './video-progress.css';
export const videoTime=value=>{const s=Math.max(0,Math.floor(value||0));return s>=3600?`${Math.floor(s/3600)}:${String(Math.floor(s/60)%60).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`:`${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;};
export function VideoSyncFeedback({progress}){
  if(!['error','conflict','pending'].includes(progress.status)&&!progress.localError)return null;
  return <div className="reading-feedback" role="status"><span>{progress.error||progress.localError||'有播放位置尚未同步'}</span><button onClick={progress.status==='conflict'?progress.replace:progress.retry}>{progress.status==='conflict'?(progress.clearing?'重新确认清除':'同步本页位置'):'重试同步'}</button>{progress.hasPending&&<button onClick={progress.discard}>放弃本次同步</button>}</div>;
}
export function VideoPlayer({item,title,progress,onError}) {
  const video=useRef(),touched=useRef(false),last=useRef(null),lastTime=useRef(0),latest=useRef(),[ready,setReady]=useState(false);
  latest.current={item,progress};
  useEffect(()=>{progress.allowItem(item.id);},[item.id]);
  const entry=progress.data?.entries.find(e=>e.item_id===item.id),[resume,setResume]=useState(null);
  useEffect(()=>{if(!touched.current)setResume(entry||null);},[entry]);
  const capture=(force=false,element=video.current)=>{
    const el=element,{item,progress}=latest.current;
    if(!el||!touched.current||item.deleted_at||progress.library!==item.collection_id||!Number.isFinite(el.duration)||el.duration<=0||!Number.isFinite(el.currentTime))return;
    const value={item_id:item.id,position:Math.round(el.currentTime*1000)/1000,duration:el.duration,completed:el.ended};
    const key=JSON.stringify(value);if(last.current===key||!force&&Date.now()-lastTime.current<10000)return;
    last.current=key;lastTime.current=Date.now();progress.record(value);if(force)progress.leave();
  };
  const captureRef=useRef(capture);captureRef.current=capture;
  useEffect(()=>{const element=video.current,hide=()=>captureRef.current(true,element),visibility=()=>{if(document.hidden)hide();};window.addEventListener('pagehide',hide);window.addEventListener('znote:leaving-preview',hide);document.addEventListener('visibilitychange',visibility);return()=>{hide();window.removeEventListener('pagehide',hide);window.removeEventListener('znote:leaving-preview',hide);document.removeEventListener('visibilitychange',visibility);};},[]);
  const seek=position=>{if(!video.current||!ready)return;touched.current=true;video.current.currentTime=Math.min(position,video.current.duration);setResume(null);};
  return <><video ref={video} src={item.url} poster={item.thumbnail_url} controls preload="metadata" playsInline aria-label={`播放 ${title}`} onError={onError}
    onLoadedMetadata={()=>{setReady(true);if(item.resume_position!==undefined){touched.current=true;setResume(null);video.current.currentTime=Math.min(item.resume_position,video.current.duration);}}}
    onPlay={()=>{touched.current=true;setResume(null);}} onSeeking={()=>{touched.current=true;setResume(null);}} onSeeked={()=>capture(true)} onTimeUpdate={()=>capture()} onPause={()=>capture(true)} onEnded={()=>capture(true)}/>
    {resume&&<div className="video-resume-actions"><span>{resume.completed?'上次已看完':`上次看到 ${videoTime(resume.position)}`}</span><button disabled={!ready} onClick={()=>seek(resume.completed?0:resume.position)}>{resume.completed?'从头查看':`继续到 ${videoTime(resume.position)}`}</button>{!resume.completed&&<button disabled={!ready} onClick={()=>seek(0)}>从头查看</button>}<HelpHint label="播放位置同步">每 10 秒同步，暂停、拖动、隐藏或关闭预览时保存。继续查看只定位，不自动播放声音。记录按知识库隔离，最多 20 条，完整备份可恢复。</HelpHint></div>}
    <VideoSyncFeedback progress={progress}/>
  </>;
}
export function VideoHistory({progress,onOpen,open,setOpen,disabled}) {
  const entries=progress.data?.entries||[],first=entries.find(e=>!e.completed);
  return <><div className="reading-resume">{first&&<button className="reading-resume-main" disabled={disabled} onClick={()=>onOpen(first)}><img src={first.thumbnail_url} alt="" loading="lazy"/><span><small>继续观看</small><strong>{first.title}</strong></span><span>{videoTime(first.position)}</span></button>}<button className="text-button" onClick={()=>{setOpen(true);progress.reload();}}><History size={15}/>播放记录</button></div>{!open&&<VideoSyncFeedback progress={progress}/>}
    {open&&<Dialog title="播放记录" className="reading-dialog" onClose={()=>setOpen(false)}><div className="reading-history-body"><div className="reading-history-heading"><span>当前知识库 · 最近 {entries.length} 个视频</span><HelpHint label="播放记录">记录已同步的播放位置，其他设备可以继续观看。删除或移动后失效的条目隐藏；清除记录不删除视频。</HelpHint><button aria-label="刷新播放记录" onClick={progress.reload}><RefreshCw size={15}/></button></div><VideoSyncFeedback progress={progress}/>{!entries.length&&<p className="reading-empty">播放视频后，可在这里继续观看。</p>}{entries.map(row=><button key={row.item_id} className="reading-history-row" disabled={disabled} onClick={()=>{setOpen(false);onOpen(row)}}><img src={row.thumbnail_url} alt="" loading="lazy"/><span><strong>{row.title}</strong><small>{row.completed?'已看完':videoTime(row.position)+' / '+videoTime(row.duration)}</small></span></button>)}</div><footer className="feature-actions"><button disabled={!entries.length||progress.status==='saving'} onClick={progress.clear}>清除播放记录</button><button onClick={()=>setOpen(false)}>完成</button></footer></Dialog>}
  </>;
}
