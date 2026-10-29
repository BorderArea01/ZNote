export const connectHtml=`<!doctype html><html lang="zh-CN"><head><meta name="znote-app" content="remote-capture"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>连接 ZNote App</title><link rel="stylesheet" href="/portal.css"></head><body><main><header><span class="logo">Z</span><div><h1>ZNote</h1><p>远程采集连接</p></div></header><section class="connect-card"><h2>连接 ZNote App</h2><p id="address"></p><div id="ready" hidden><p>自动配置地址和采集授权。</p><a id="import" class="import-button">导入 ZNote App</a><button type="button" data-znote-connect data-znote-remote-connect>连接浏览器扩展备用</button><p id="znote-connect-status" role="status"></p><div class="alternatives"><button id="copy" class="secondary" type="button">复制备用配置</button><button id="browser" class="secondary" type="button">用网页采集</button></div></div><form id="recover" hidden><label>完整邀请链接<input id="invitation-input" type="text" autocomplete="off" placeholder="粘贴收到的完整邀请链接" required></label><button>打开邀请</button></form><p id="status" role="status" aria-live="polite"></p><a id="update" href="https://github.com/BorderArea01/ZNote/releases" target="_blank" rel="noreferrer">下载 Android App</a></section></main><script type="module" src="/connect.js"></script></body></html>`;
export const connectCss=`.connect-card{padding:24px;border:1px solid #344d41;border-radius:18px;background:#19271f}.import-button{display:block;padding:14px;text-align:center;text-decoration:none;background:#47765b;border:1px solid #6c987b;border-radius:12px;font-size:16px;font-weight:600;color:#f1f8f3;margin:24px 0 14px}.import-button:focus-visible{outline:2px solid #a3d6b3;outline-offset:3px}#address{overflow-wrap:anywhere;font-size:12px;color:#9caf9f}.connect-card p{font-size:13px;color:#afc5b6}.alternatives{display:flex;gap:12px;flex-wrap:wrap;margin:0 0 24px}.alternatives button{min-height:44px;flex:1;font-size:12px}#recover{padding:0;border:0;background:transparent;margin:0}`;
export const connectScript=String.raw`
const $=id=>document.getElementById(id);
document.querySelector('[data-znote-remote-connect]').onclick=()=>{document.getElementById('znote-connect-status').textContent='请先安装或重新加载 ZNote 网页采集扩展，再刷新本页';};
const valid=code=>typeof code==='string'&&/^[a-zA-Z0-9_-]{16,80}$/.test(code);
function invitationCode(value){
 if(valid(value))return value;
 const url=new URL(value,location.origin);
 if(url.protocol==='znote:'&&url.hostname==='connect'&&url.searchParams.get('server')===location.origin)return url.searchParams.get('code');
 if(url.origin!==location.origin||url.username||url.password)return null;
 const path=url.pathname.match(/^\/connect\/([a-zA-Z0-9_-]{16,80})\/?$/);
 if(path)return path[1];
 return url.pathname==='/connect'?(new URLSearchParams(url.hash.slice(1)).get('code')||url.searchParams.get('code')):null;
}
fetch('/downloads/latest.json').then(r=>r.ok?r.json():null).then(release=>{
 if(release&&/^\/downloads\/ZNote-[0-9.]+(?:-beta\.[0-9]+)?-android\.apk$/.test(release.apk)){$('update').href=release.apk;$('update').textContent='下载 ZNote '+release.version;}
}).catch(()=>{});
$('address').textContent=location.origin;
let code;try{code=invitationCode(location.href);}catch{}
if(!valid(code)){
 $('recover').hidden=false;$('status').textContent='这里没有连接信息，请打开收到的完整邀请链接。';
 $('recover').onsubmit=e=>{e.preventDefault();try{const next=invitationCode($('invitation-input').value.trim());if(!valid(next))throw Error();location.assign('/connect/'+encodeURIComponent(next));}catch{$('status').textContent='请粘贴完整的 ZNote 邀请链接。';}};
}else{
 // Keep a complete, reloadable URL. Do not erase the only copy of the invite.
 history.replaceState(null,'','/connect/'+encodeURIComponent(code));
 const query=new URLSearchParams({server:location.origin,code}),configuration='znote://connect?'+query;
 $('import').href='intent://connect?'+query+'#Intent;scheme=znote;package=io.github.borderarea01.znote;end';$('ready').hidden=false;
 $('copy').onclick=async()=>{try{await navigator.clipboard.writeText(configuration);$('status').textContent='已复制。在 ZNote 连接页点「导入连接邀请」粘贴即可。';}catch{$('status').textContent='浏览器未允许复制，请用系统浏览器打开这条邀请。';}};
 $('browser').onclick=async()=>{const b=$('browser');b.disabled=true;try{const response=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:code})});const data=await response.json();if(!response.ok)throw Error(data.error||'连接失败');location.replace('/');}catch(e){$('status').textContent=e.message;b.disabled=false;}};
}
`;
