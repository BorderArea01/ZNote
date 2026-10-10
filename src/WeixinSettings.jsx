import {HelpHint} from './HelpHint.jsx';
import React,{useEffect,useRef,useState} from 'react';
import QRCode from 'qrcode';
import {MessageCircle,RefreshCw} from 'lucide-react';
import {api,send} from './api.js';
import './weixin.css';
import {WeixinNotificationsSettings} from './WeixinNotificationsSettings.jsx';
const json=(path,method,body)=>send(path,body,method);
export function WeixinSettings({collections,onOpen}){
  const [state,setState]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[collection,setCollection]=useState(''),[tags,setTags]=useState('微信'),[qrImage,setQrImage]=useState(''),[code,setCode]=useState('');
  const initialized=useRef(false),mounted=useRef(true);
  const [captureLinks,setCaptureLinks]=useState(false);
  const [mode,setMode]=useState('daily'),[newTitle,setNewTitle]=useState('');
  const accept=data=>{if(!mounted.current)return;setState(data);if(!initialized.current){setCollection(data.collection_id||'');setTags(data.tags.join(', '));setMode(data.merge_mode||'daily');setCaptureLinks(!!data.capture_links);initialized.current=true;}};
  const load=()=>api('/api/weixin').then(accept).catch(e=>{if(mounted.current)setError(e.message)});
  useEffect(()=>{mounted.current=true;let timer,stopped=false;const poll=async()=>{if(!document.hidden)await load();if(!stopped)timer=setTimeout(poll,3000)};poll();return()=>{stopped=true;mounted.current=false;clearTimeout(timer)};},[]);
  useEffect(()=>{let valid=true;setQrImage('');if(state?.login?.image)QRCode.toDataURL(state.login.image,{width:240,margin:2}).then(value=>{if(valid)setQrImage(value)}).catch(()=>setError('二维码生成失败，请重试'));return()=>{valid=false};},[state?.login?.image]);
  const act=async fn=>{setBusy(true);setError('');try{accept(await fn())}catch(e){setError(e.message)}finally{if(mounted.current)setBusy(false)}};
  const config=enabled=>json('/api/weixin','PATCH',{enabled,capture_links:captureLinks,collection_id:collection||null,merge_mode:mode,tags:tags.split(/[,，]/).map(t=>t.trim()).filter(Boolean)});
  const login=state?.login,showQr=login&&['wait','scaned','scaned_but_redirect','need_verifycode'].includes(login.status);
  const labels={pending:'等待入库',working:'正在入库',done:'已入库',failed:'失败',skipped:'已忽略'};
  return <section className="weixin-settings">
    <div className="settings-title"><MessageCircle size={20}/><h3>微信收件箱</h3><HelpHint label="微信收件">微信文字和图片连续收进笔记，零碎灵感按天或手动分篇收集；配图自动成组。</HelpHint><button className="icon-button" title="刷新状态" aria-label="刷新微信状态" onClick={load}><RefreshCw size={16}/></button></div>
    {error&&<p role="alert">{error}</p>}
    {!state?<p className="muted">正在读取连接状态…</p>:<>
      <div className="weixin-fields"><label>默认知识库<select aria-label="微信默认知识库" value={collection} onChange={e=>setCollection(e.target.value)} disabled={busy}><option value="">未分类</option>{collections.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>入库标签<input aria-label="微信入库标签" value={tags} onChange={e=>setTags(e.target.value)} placeholder="用逗号分隔" disabled={busy}/></label></div>
      <div className="weixin-grouping"><label><span className="field-help-label">归档方式<HelpHint label="归档方式">按天合并：同一天的文字和图片依次追加，跨天自动新建。手动分篇：持续追加到当前篇，换话题时开始新篇。配图统一成组。</HelpHint></span><select aria-label="微信归档方式" value={mode} onChange={e=>setMode(e.target.value)} disabled={busy}><option value="daily">按天合并（北京时间）</option><option value="session">手动分篇，持续追加</option><option value="message">每条单独保存</option></select></label>
      </div>
      <div className="inline-heading"><label><input type="checkbox" checked={captureLinks} onChange={e=>setCaptureLinks(e.target.checked)} disabled={busy}/>采集消息里的链接</label><HelpHint label="微信链接采集">发送作品分享链接，服务器下载正文、配图或视频，并在收件笔记里附上归档入口。需要登录或验证时保留失败记录。关闭时仅保存消息文字；仅影响新消息。</HelpHint></div>
      <div className="connection-actions">
        <button disabled={busy} className="primary" onClick={()=>act(async()=>{await config(state.enabled);return json('/api/weixin/login','POST',{})})}>{busy?'处理中…':state.connected?'重新扫码连接':'扫码连接微信'}</button>
        <button disabled={busy} onClick={()=>act(()=>config(state.enabled))}>保存收件设置</button>
        {state.connected&&<><button disabled={busy} onClick={()=>act(()=>config(!state.enabled))}>{state.enabled?'暂停接收':'恢复接收'}</button><button disabled={busy} onClick={()=>act(()=>json('/api/weixin/login','DELETE'))}>断开连接</button></>}
      </div>
      <p role="status" className="muted">{state.lastError||state.status}{state.connected?' · 仅接收绑定账号的消息':''}</p>
      {state.connected&&state.merge_mode!=='message'&&<div className="weixin-current"><div><strong className="field-help-label">当前收件笔记<HelpHint label="开始新篇">也可以在微信发送 /新篇 主题名，后续消息归入新篇。</HelpHint></strong><span>{state.current_note?.title||'收到下一条消息时创建'}{state.current_note?.pending?' · 等待收件':''}</span>{state.current_note?.id&&onOpen&&<button onClick={()=>onOpen(state.current_note.id)}>打开笔记</button>}</div><div className="weixin-new-note"><input aria-label="微信新篇标题" maxLength={80} value={newTitle} onChange={e=>setNewTitle(e.target.value)} placeholder="新篇标题（可留空）" disabled={busy}/><button disabled={busy||mode==='message'} onClick={()=>act(async()=>{await config(state.enabled);const result=await json('/api/weixin/new-note','POST',{title:newTitle});setNewTitle('');return result;})}>开始新篇</button></div></div>}
      {showQr&&<div className="weixin-qr">{qrImage&&<img src={qrImage} alt="使用微信扫码连接 ZNote" width="240" height="240"/>}<p>{login.status==='scaned'?'已扫码，请在手机上确认':'打开微信扫一扫，确认连接'}</p>{login.status==='need_verifycode'&&<div><input value={code} onChange={e=>setCode(e.target.value)} aria-label="微信验证码" inputMode="numeric" placeholder="手机显示的验证码"/><button disabled={busy} onClick={()=>act(()=>json('/api/weixin/verify','POST',{id:login.id,code}))}>提交验证码</button></div>}</div>}
      {login&&['expired','failed','verify_code_blocked','binded_redirect'].includes(login.status)&&<p role="alert">{login.error||'二维码已失效或当前绑定不可用，请重新扫码。'}</p>}
      {!!state.jobs.length&&<details><summary>最近收件 · {state.jobs.length} 条{state.failed_count?` · ${state.failed_count} 条失败优先`:""}</summary><ol className="weixin-receipts">{state.jobs.map(job=><li key={job.id}><div><strong>{job.title}</strong><span>{labels[job.state]||job.state}</span></div>{job.error&&<p>{job.error}</p>}{job.state==='done'&&job.items?.length>0&&onOpen&&<button onClick={()=>onOpen(job.items[0])}>查看内容</button>}{job.state==='failed'&&<div><button disabled={busy} onClick={()=>act(()=>json('/api/weixin/jobs/'+job.id+'/retry','POST',{}))}>重试</button><button disabled={busy} onClick={()=>act(()=>json('/api/weixin/jobs/'+job.id+'/skip','POST',{}))}>忽略</button></div>}</li>)}</ol></details>}
      <div className="field-help-label">收件与图片清晰度<HelpHint label="收件与图片清晰度"><p>需要高清图片时，将 JPG、PNG、WebP、GIF 或 AVIF 作为文件附件发送到绑定的微信会话。ZNote 按原始字节保存，单张最多 100 MB；普通图片也不再受采集自动压缩设置影响。</p><p>普通图片消息仍取微信提供的原文件，而不是缩略图。不过微信通道可能已压缩图片，勾选“原图”也不保证通道下发拍摄原件；已有模糊图片无法恢复细节，需要重新发送原始文件。</p><p>默认按消息发送日期（北京时间）合并，文字、图片和图片附件分开发送也会追加到同一篇笔记。追加保留已有标题、正文与封面顺序；旧笔记不自动合并，设置变化只影响新消息。</p><p>单篇最多 50 万字符、30 个标签；同篇前一条失败时后续消息等待，重试或忽略后继续。不接收群聊、语音、视频或其他文件；聊天图片不会自动获得原网站链接。</p><p>需要当前微信账号可使用 ClawBot 入口。电脑保持开机并连接网络才能接收，无需将知识库开放到公网。</p></HelpHint></div>
    </>}
    <WeixinNotificationsSettings/>
  </section>;
}
