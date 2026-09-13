import React,{useEffect,useState} from 'react';
import {api,send} from './api.js';

export function WeixinNotificationsSettings(){
  const [state,setState]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[result,setResult]=useState('');
  useEffect(()=>{
    let stopped=false,timer;
    const poll=async()=>{try{const data=await api('/api/weixin/notifications');if(!stopped)setState(data);}catch(e){if(!stopped)setError(e.message);}if(!stopped)timer=setTimeout(poll,5000);};
    void poll();return()=>{stopped=true;clearTimeout(timer)};
  },[]);
  const act=async operation=>{setBusy(true);setError('');setResult('');try{await operation();}catch(e){setError(e.message);}finally{try{setState(await api('/api/weixin/notifications'));}catch(e){setError(e.message);}setBusy(false)}};
  const labels={sending:'提交中',accepted:'微信已接受',rejected:'微信拒绝',unknown:'结果未确认'};
  return <section className="weixin-notifications" aria-label="微信通知发送">
    <h4>微信通知发送</h4>
    <p className="muted">复用本机已有绑定，只发送给绑定用户。不改变收件、知识库和归档规则；通知不会写入笔记。</p>
    {error&&<p role="alert">{error}</p>}
    {state&&<>
      <label><input type="checkbox" checked={state.enabled} disabled={busy} onChange={e=>{const enabled=e.target.checked;setState(previous=>({...previous,enabled}));void act(()=>send('/api/weixin/notifications',{enabled},'PATCH'));}}/> 允许外部服务发送微信通知</label>
      <p>{state.reason}</p>
      <p className="muted">外部服务请在下方 API 令牌区域创建“仅通知”令牌。仅通知令牌不能读写笔记、读取微信消息或更改绑定。</p>
      <button disabled={busy||!state.ready} onClick={()=>{
        if(!window.confirm('向当前绑定微信发送一条明确标注的测试通知？不会触发设备动作。'))return;
        void act(async()=>{const receipt=await send('/api/weixin/notifications',{idempotency_key:'test-'+crypto.randomUUID(),title:'【测试】设备通知通道',body:'这是 ZNote 通知发送测试，不代表设备发生故障，不会触发门禁或机器人动作。'});setResult(receipt.detail);});
      }}>发送测试通知</button>
      {result&&<p role="status">{result}</p>}
      <details><summary>最近发送记录 · {state.receipts.length} 条</summary><ol className="weixin-receipts">{state.receipts.map(row=><li key={row.idempotency_key+row.created_at}><div><strong>{row.idempotency_key}</strong><span>{labels[row.status]||row.status}</span></div><p>{row.detail}</p><small>{new Date(row.created_at).toLocaleString()}</small></li>)}</ol></details>
      <p className="muted">微信接口接受不等于手机已展示。上下文失效时，需要在原 ClawBot 会话发送一条正常收件消息；这条消息仍按原规则归档。结果不明时不会自动重发。</p>
    </>}
  </section>;
}
