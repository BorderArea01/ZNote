import React,{useEffect,useState} from 'react';
import {installOffer,subscribeInstall,installApp} from './install-app.js';
const REPO='https://github.com/BorderArea01/ZNote';
export function ClientSettings(){
 const [install,setInstall]=useState(installOffer),[message,setMessage]=useState('');
 useEffect(()=>subscribeInstall(setInstall),[]);
 return <section><div className="settings-title"><h3>客户端与反馈</h3></div><p className="muted">在电脑和手机上访问同一个知识库。</p><div className="connection-actions"><a className="button" href={REPO+'/releases'} target="_blank" rel="noreferrer">下载客户端</a>{install&&<button onClick={async()=>{try{await installApp()}catch{setMessage('安装未完成，可从浏览器菜单重试')}}}>添加到桌面</button>}<a className="button" href={REPO+'/issues/new/choose'} target="_blank" rel="noreferrer">反馈问题</a><a className="button" href={REPO+'/discussions'} target="_blank" rel="noreferrer">交流与建议</a></div>{message&&<p role="status">{message}</p>}<details><summary>iPhone / iPad 与主屏幕安装</summary><p>用 Safari 打开此知识库，选择「分享 → 添加到主屏幕」。支持的浏览器在 HTTPS 或本机地址上也可提供安装入口；局域网 HTTP 的安装能力以浏览器为准。</p><p>主屏幕入口仍需连接运行中的 ZNote，不提供整库离线同步。安装、更新及各平台说明见 <a href={REPO+'/blob/main/docs/CLIENTS.md'} target="_blank" rel="noreferrer">客户端指南</a>。</p></details></section>
}
