import React,{useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {Music2,Play,Pause,Download,Upload,X} from 'lucide-react';
import {api,send} from './api.js';
import {HelpHint} from './HelpHint.jsx';
import './bgm.css';
const time=value=>`${Math.floor((Number(value)||0)/60)}:${String(Math.floor((Number(value)||0)%60)).padStart(2,'0')}`;
// The player belongs to Workspace: Detail is remounted when turning a page.
export function useBgmPlayback(item){
  const audio=useRef(),[playing,setPlaying]=useState(false);
  const identity=item?.bgm&&!item.deleted_at?JSON.stringify([item.collection_id,item.group_key||item.id,item.bgm.hash]):'';
  const src=useMemo(()=>identity?item.bgm.url:undefined,[identity]);
  useLayoutEffect(()=>{const el=audio.current;if(!el)return;el.pause();setPlaying(false);el.load();},[identity]);
  useEffect(()=>{const stop=()=>audio.current?.pause();window.addEventListener('pagehide',stop);window.addEventListener('znote:auth-required',stop);return()=>{stop();window.removeEventListener('pagehide',stop);window.removeEventListener('znote:auth-required',stop);};},[]);
  return {audio,playing,identity,element:<audio data-znote-bgm ref={audio} src={src} preload="none" loop onPlay={()=>setPlaying(true)} onPause={()=>setPlaying(false)} onEnded={()=>setPlaying(false)}/>};
}
export function BgmControls({item,playback,disabled,onChanged}){
  const input=useRef(),alive=useRef(true),[failedJob,setFailedJob]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[position,setPosition]=useState(0),[duration,setDuration]=useState(item.bgm?.duration||0),[volume,setVolume]=useState(1);
  useEffect(()=>{alive.current=true;const controller=new AbortController();if(item.id&&!item.bgm)api('/api/captures',{signal:controller.signal}).then(result=>{const rows=Array.isArray(result)?result:result.jobs||[];setFailedJob(rows.find(job=>job.bgm_status==='failed'&&job.bgm_item_ids?.includes(item.id))||null);}).catch(()=>{});return()=>{alive.current=false;controller.abort();};},[item.id,item.bgm?.hash]);
  useEffect(()=>{const el=playback.audio.current,update=()=>{setPosition(el.currentTime||0);setDuration(Number.isFinite(el.duration)?el.duration:item.bgm?.duration||0);setVolume(el.volume);},failed=()=>setError('配乐暂时无法播放，请重试');el.addEventListener('timeupdate',update);el.addEventListener('loadedmetadata',update);el.addEventListener('error',failed);update();return()=>{el.removeEventListener('timeupdate',update);el.removeEventListener('loadedmetadata',update);el.removeEventListener('error',failed);};},[playback.identity]);
  async function toggle(){setError('');const el=playback.audio.current;if(!el.paused){el.pause();return;}try{if(el.error)el.load();await el.play();}catch{setError('配乐暂时无法播放，请重试');}}
  async function upload(file){if(!file)return;setBusy(true);setError('');try{const form=new FormData();form.set('file',file);form.set('version',item.version);const result=await api(`/api/items/${item.id}/bgm`,{method:'POST',body:form});if(alive.current)onChanged(result);}catch(e){if(alive.current)setError(e.message);}finally{if(alive.current)setBusy(false);if(input.current)input.current.value='';}}
  async function remove(){setBusy(true);setError('');try{const result=await send(`/api/items/${item.id}/bgm`,{version:item.version},'DELETE');if(alive.current)onChanged(result);}catch(e){if(alive.current)setError(e.message);}finally{if(alive.current)setBusy(false);}}
  async function retry(){setBusy(true);setError('');try{await send(`/api/captures/${failedJob.id}/retry`,{});const deadline=Date.now()+100000;while(alive.current&&Date.now()<deadline){await new Promise(r=>setTimeout(r,1000));if(!alive.current)return;const job=await api(`/api/captures/${failedJob.id}`);if(['completed','failed'].includes(job.status)){if(job.bgm_status!=='saved')throw Error(job.bgm_error||job.message);const updated=await api(`/api/items/${item.id}`);if(alive.current){onChanged({item:updated,items:[updated]});setFailedJob(null);}return;}}if(alive.current)throw Error('配乐仍在后台处理，可稍后重新打开查看');}catch(e){if(alive.current)setError(e.message);}finally{if(alive.current)setBusy(false);}}
  if(!item.id||item.deleted_at)return null;
  return <section className="bgm-control" aria-label="作品配乐">
    <div className="bgm-heading"><Music2 size={16}/><span className="bgm-title">{item.bgm?item.bgm.title:'作品配乐'}{item.bgm?.author&&<small>{item.bgm.author}</small>}</span>
      <HelpHint label="作品配乐">采集时自动保存平台提供的配乐，同组共用一份。点击播放后循环，同组翻页不中断；关闭预览停止。播放配乐时视频暂时静音。可上传 50 MB 以内的音频；替换或移除会应用到当前组。先保存文字修改，再调整配乐。</HelpHint>
      <button className="bgm-icon" aria-label={item.bgm?'替换配乐':'添加配乐'} disabled={disabled||busy} onClick={()=>input.current.click()}><Upload size={15}/></button>
      {item.bgm&&<><a className="bgm-icon" aria-label="下载配乐" href={item.bgm.url} download={item.bgm.title+'.'+(({'audio/mpeg':'mp3','audio/mp4':'m4a','audio/aac':'aac','audio/ogg':'ogg','audio/wav':'wav','audio/webm':'webm'})[item.bgm.mime])}><Download size={15}/></a><button className="bgm-icon" aria-label="移除配乐" disabled={disabled||busy} onClick={remove}><X size={15}/></button></>}
    </div>
    <input ref={input} hidden type="file" accept="audio/*,.mp3,.m4a,.aac,.ogg,.wav,.webm" onChange={e=>upload(e.target.files[0])}/>
    {item.bgm&&<div className="bgm-playback"><button aria-label={playback.playing?'暂停配乐':'播放配乐'} onClick={toggle}>{playback.playing?<Pause size={17}/>:<Play size={17}/>}</button><input aria-label="配乐进度" type="range" min="0" max={duration||1} step="0.1" value={Math.min(position,duration||0)} onChange={e=>{const el=playback.audio.current;if(Number.isFinite(el.duration))el.currentTime=Number(e.target.value);}}/><span>{time(position)} / {time(duration)}</span><input className="bgm-volume" aria-label="配乐音量" type="range" min="0" max="1" step="0.05" value={volume} onChange={e=>{const v=Number(e.target.value);playback.audio.current.volume=v;setVolume(v);}}/></div>}
    {failedJob&&!item.bgm&&<div className="bgm-retry"><span>{failedJob.bgm_error||'配乐未保存'}</span><button disabled={busy||disabled} onClick={retry}>重试配乐</button></div>}
    {busy&&<span role="status">正在保存配乐…</span>}{error&&<p className="error" role="alert">{error}</p>}
  </section>;
}
