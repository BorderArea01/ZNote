import React,{useState} from 'react';
import {Sparkles} from 'lucide-react';
const key='znote.external-assistant';
function read(){try{return localStorage.getItem(key)||''}catch{return ''}}
function defaultUrl(){const url=new URL(location.origin);url.port='3743';return url.href;}
function normalize(value){const url=new URL(value);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error('请填写 HTTP / HTTPS 助手地址，不要包含令牌');return url.href;}
export function ExternalAssistantLink({collection}){
  return <button className="text-button" onClick={()=>{const url=new URL(normalize(read()||defaultUrl()));url.searchParams.set('collection',collection||'unfiled');window.open(url.href,'_blank','noopener,noreferrer')}}><Sparkles size={16}/>知识库助手</button>;
}
export function ExternalAssistantSettings(){
  const [value,setValue]=useState(read),[message,setMessage]=useState('');
  return <section><div className="settings-title"><h3>外部知识库助手</h3></div><p>通过独立服务使用当前知识库。连接时仅传递知识库编号，不在链接中传递访问密码或令牌。</p><label className="feature-field">助手地址<input aria-label="外部助手地址" type="url" placeholder={defaultUrl()} value={value} onChange={e=>setValue(e.target.value)}/></label><div className="connection-actions"><button onClick={()=>{try{value.trim()?localStorage.setItem(key,normalize(value.trim())):localStorage.removeItem(key);setMessage('已保存此浏览器的助手地址')}catch(e){setMessage(e.message)}}}>保存地址</button></div>{message&&<p role="status">{message}</p>}</section>;
}
