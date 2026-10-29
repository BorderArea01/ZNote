// Only a real click in the top-level, logged-in ZNote page starts pairing.
document.addEventListener(
  "click",
  async (event) => {
    if (!event.isTrusted || window !== top) return;
    const button = event.target.closest?.("[data-znote-connect]");
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    button.disabled = true;
    const status = document.getElementById("znote-connect-status");
    try {
      if (status) status.textContent = "正在连接浏览器扩展…";
      if(button.hasAttribute('data-znote-remote-connect')){
        // The same one-use invitation can authorize either an Android app or
        // this browser. Merely opening/previewing it never consumes the code.
        const probe=await fetch('/api/collections',{credentials:'same-origin'});
        if(probe.status===401){const code=location.pathname.match(/^\/connect\/([a-zA-Z0-9_-]{16,80})\/?$/)?.[1];if(code){const login=await fetch('/api/auth/login',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:code})});if(!login.ok){const value=await login.json();throw Error(value.error||'连接邀请已失效');}}}
        const response=await fetch('/api/tokens',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'浏览器扩展 · 远程备用',scope:'write'})});
        const device=await response.json();if(!response.ok)throw Error(device.error||'远程授权失败，请先登录');
        const result=await chrome.runtime.sendMessage({type:'znote-connect-remote',token:device.token});
        if(!result?.ok){await fetch('/api/auth/logout',{method:'POST',credentials:'omit',headers:{Authorization:'Bearer '+device.token}}).catch(()=>{});throw Error(result?.error||'备用入口连接失败');}
        if(status)status.textContent='已连接扩展备用入口；本机可达时仍优先直连';return;
      }
      const response = await fetch("/api/clipper/pair", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "无法连接知识库");
      const result = await chrome.runtime.sendMessage({
        type: "znote-connect",
        code: data.code,
      });
      if (!result?.ok) throw new Error(result?.error || "连接失败");
      if (status) status.textContent = "扩展已连接此知识库，无需填写 API 令牌";
    } catch (e) {
      if (status) status.textContent = e.message;
    } finally {
      button.disabled = false;
    }
  },
  true,
);
