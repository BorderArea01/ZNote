const bridge=window.znoteLauncher,status=document.querySelector('#status'),address=document.querySelector('#address');
async function act(fn){document.querySelectorAll('button,input').forEach(e=>e.disabled=true);status.textContent='正在连接，请稍候…';try{const r=await fn();status.textContent=r.error||r.message||'';}catch{status.textContent='连接失败，请检查知识库地址与网络。'}finally{document.querySelectorAll('button,input').forEach(e=>e.disabled=false)}}
bridge.state().then(s=>{address.value=s.address||'';document.querySelector('#version').textContent='ZNote '+s.version;});
document.querySelector('#connect').addEventListener('submit',e=>{e.preventDefault();act(()=>bridge.connect(address.value))});document.querySelector('#local').addEventListener('click',()=>act(()=>bridge.local()));document.querySelector('#feedback').addEventListener('click',()=>bridge.feedback());

document.querySelector('#media').addEventListener('click',()=>act(()=>bridge.media()));
