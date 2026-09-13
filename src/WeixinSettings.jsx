import React,{useEffect,useRef,useState} from 'react';
import QRCode from 'qrcode';
import {MessageCircle,RefreshCw} from 'lucide-react';
import {api,send} from './api.js';
import './weixin.css';
const json=(path,method,body)=>send(path,body,method);
export function WeixinSettings({collections}){
  const [state,setState]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[collection,setCollection]=useState(''),[tags,setTags]=useState('微信'),[qrImage,setQrImage]=useState(''),[code,setCode]=useState('');
  const initialized=useRef(false),mounted=useRef(true);
  const accept=data=>{if(!mounted.current)return;setState(data);if(!initialized.current){setCollection(data.collection_id||'');setTags(data.tags.join(', '));initialized.current=true;}};
  const load=()=>api('/api/weixin').then(accept).catch(e=>{if(mounted.current)setError(e.message)});
  useEffect(()=>{mounted.current=true;let timer,stopped=false;const poll=async()=>{if(!document.hidden)await load();if(!stopped)timer=setTimeout(poll,3000)};poll();return()=>{stopped=true;mounted.current=false;clearTimeout(timer)};},[]);
  useEffect(()=>{let valid=true;setQrImage('');if(state?.login?.image)QRCode.toDataURL(state.login.image,{width:240,margin:2}).then(value=>{if(valid)setQrImage(value)}).catch(()=>setError('二维码生成失败，请重试'));return()=>{valid=false};},[state?.login?.image]);
  const act=async fn=>{setBusy(true);setError('');try{accept(await fn())}catch(e){setError(e.message)}finally{if(mounted.current)setBusy(false)}};
  const config=enabled=>json('/api/weixin','PATCH',{enabled,collection_id:collection||null,tags:tags.split(/[,，]/).map(t=>t.trim()).filter(Boolean)});
  const login=state?.login,showQr=login&&['wait','scaned','scaned_but_redirect','need_verifycode'].includes(login.status);
  const labels={pending:'等待入库',working:'正在入库',done:'已入库',failed:'失败',skipped:'已忽略'};
  return <section className="weixin-settings">
    <div className="settings-title"><MessageCircle size={20}/><h3>微信收件箱</h3><button className="icon-button" title="刷新状态" aria-label="刷新微信状态" onClick={load}><RefreshCw size={16}/></button></div>
    <p className="muted">在微信收集入口发送文字或图片，自动保存到本机知识库。</p>
    {error&&<p role="alert">{error}</p>}
    {!state?<p className="muted">正在读取连接状态…</p>:<>
      <div className="weixin-fields"><label>默认知识库<select aria-label="微信默认知识库" value={collection} onChange={e=>setCollection(e.target.value)} disabled={busy}><option value="">未分类</option>{collections.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>入库标签<input aria-label="微信入库标签" value={tags} onChange={e=>setTags(e.target.value)} placeholder="用逗号分隔" disabled={busy}/></label></div>
      <div className="connection-actions">
        <button disabled={busy} className="primary" onClick={()=>act(async()=>{await config(state.enabled);return json('/api/weixin/login','POST',{})})}>{busy?'处理中…':state.connected?'重新扫码连接':'扫码连接微信'}</button>
        <button disabled={busy} onClick={()=>act(()=>config(state.enabled))}>保存收件设置</button>
        {state.connected&&<><button disabled={busy} onClick={()=>act(()=>config(!state.enabled))}>{state.enabled?'暂停接收':'恢复接收'}</button><button disabled={busy} onClick={()=>act(()=>json('/api/weixin/login','DELETE'))}>断开连接</button></>}
      </div>
      <p role="status" className="muted">{state.lastError||state.status}{state.connected?' · 仅接收绑定账号的消息':''}</p>
      {showQr&&<div className="weixin-qr">{qrImage&&<img src={qrImage} alt="使用微信扫码连接 ZNote" width="240" height="240"/>}<p>{login.status==='scaned'?'已扫码，请在手机上确认':'打开微信扫一扫，确认连接'}</p>{login.status==='need_verifycode'&&<div><input value={code} onChange={e=>setCode(e.target.value)} aria-label="微信验证码" inputMode="numeric" placeholder="手机显示的验证码"/><button disabled={busy} onClick={()=>act(()=>json('/api/weixin/verify','POST',{id:login.id,code}))}>提交验证码</button></div>}</div>}
      {login&&['expired','failed','verify_code_blocked','binded_redirect'].includes(login.status)&&<p role="alert">{login.error||'二维码已失效或当前绑定不可用，请重新扫码。'}</p>}
      {!!state.jobs.length&&<details><summary>最近收件 · {state.jobs.length} 条</summary><ol className="weixin-receipts">{state.jobs.map(job=><li key={job.id}><div><strong>{job.title}</strong><span>{labels[job.state]||job.state}</span></div>{job.error&&<p>{job.error}</p>}{job.state==='failed'&&<div><button disabled={busy} onClick={()=>act(()=>json('/api/weixin/jobs/'+job.id+'/retry','POST',{}))}>重试</button><button disabled={busy} onClick={()=>act(()=>json('/api/weixin/jobs/'+job.id+'/skip','POST',{}))}>忽略</button></div>}</li>)}</ol></details>}
      <details className="weixin-help"><summary>收件方式与原图说明</summary><p>文字保存为笔记，图片保存为素材；同条图文消息的配图保存在本地并成组。分开发送的消息分别入库，目前不接收语音、视频和其他文件。</p><p>微信可能在发送时压缩图片；ZNote 完整保留收到的文件。来源标记为微信，聊天图片不会自动获得原网站链接。</p><p>绑定使用微信 ClawBot 通道，需要当前微信账号可使用该入口。电脑保持开机并连接网络才能接收，无需将知识库开放到公网。更改默认知识库只影响之后收到的消息。</p></details>
    </>}
  </section>;
}
