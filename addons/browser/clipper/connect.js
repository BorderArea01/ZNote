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
