(() => {
  if (window.top !== window) return;
  const workPath = /^\/(?:explore|discovery\/item)\/[a-f\d]+\/?$/i;
  const buttons = new Set();
  let enabled = false;
  let scanTimer = 0;
  let currentPath = '';

  function workUrl(value) {
    try {
      const url = new URL(value, location.href);
      if (url.protocol !== 'https:' || url.hostname !== 'www.xiaohongshu.com' || !workPath.test(url.pathname)) return null;
      url.hash = '';
      return url.href;
    } catch { return null; }
  }
  function label(button, text, busy = false) {
    button.textContent = text;
    button.disabled = busy;
    button.setAttribute('aria-label', text === '保存到 ZNote' ? '保存这篇小红书帖子到 ZNote' : text);
    button.title = text;
  }
  function pageToken(id) {
    return new Promise(resolve => {
      const nonce = crypto.randomUUID();
      const timer = setTimeout(() => { window.removeEventListener('znote-xhs-token-response', receive); resolve({token:'',source:'',detail:''}); }, 400);
      function receive(event) {
        if (event.detail?.nonce !== nonce || event.detail?.id !== id) return;
        clearTimeout(timer);
        window.removeEventListener('znote-xhs-token-response', receive);
        resolve({token:event.detail.token || '',source:event.detail.source || '',detail:event.detail.detail || ''});
      }
      window.addEventListener('znote-xhs-token-response', receive);
      window.dispatchEvent(new CustomEvent('znote-xhs-token-request', {detail:{id,nonce}}));
    });
  }
  async function browserPage(url) {
    const id = new URL(url).pathname.match(/[a-f\d]+\/?$/i)?.[0]?.replace(/\/$/, '');
    if (!id) return '';
    const scripts = [];
    const access = await pageToken(id);
    if (access.detail) scripts.push(`<script>window.__INITIAL_STATE__=${access.detail}</script>`);
    function appendScripts(doc) {
      for (const script of doc.querySelectorAll('script:not([src])')) {
        const value = script.textContent || '';
        if (value.includes(id) && /__INITIAL_STATE__|__SETUP_SERVER_STATE__|noteDetailMap/.test(value) && new TextEncoder().encode(script.outerHTML).length < 1400000) scripts.push(script.outerHTML);
      }
    }
    if (workUrl(location.href)?.split('?')[0] === url.split('?')[0]) appendScripts(document);
    const requestUrl = new URL(url);
    if (!requestUrl.searchParams.has('xsec_token')) {
      if (access.token) {
        const source = access.source || (location.pathname.startsWith('/search_result') ? 'pc_search' : location.pathname.startsWith('/user/profile') ? 'pc_user' : 'pc_feed');
        requestUrl.searchParams.set('xsec_token', access.token);
        requestUrl.searchParams.set('xsec_source', source);
      }
    }
    try {
      const response = await fetch(requestUrl, { credentials: 'include', signal: AbortSignal.timeout(15000) });
      if (response.ok && response.headers.get('content-type')?.includes('text/html') && workUrl(response.url)?.split('?')[0] === url.split('?')[0]) {
        appendScripts(new DOMParser().parseFromString(await response.text(), 'text/html'));
      }
    } catch {}
    let result = '<html><body>';
    for (const script of scripts) if (new TextEncoder().encode(result + script).length < 1500000) result += script;
    return result === '<html><body>' ? '' : result + '</body></html>';
  }
  function buttonFor(url, detail = false) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `znote-xhs-post-button${detail ? ' znote-xhs-detail-button' : ''}`;
    button.dataset.znoteUrl = url;
    label(button, '保存到 ZNote');
    buttons.add(button);
    button.addEventListener('click', async event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (button.disabled) return;
      label(button, '采集中…', true);
      try {
        const postUrl = button.dataset.znoteUrl;
        const pageHtml = await browserPage(postUrl);
        const sourceUrl = new URL(postUrl);
        sourceUrl.search = '';
        const result = await chrome.runtime.sendMessage({ type: 'xhs-post-capture', url: sourceUrl.href, pageHtml });
        if (!result?.ok) throw new Error(result?.error || '提交失败');
        let job = result.job;
        for (let i = 0; i < 150 && ['queued', 'running'].includes(job.status); i++) {
          await new Promise(resolve => setTimeout(resolve, 2000));
          const next = await chrome.runtime.sendMessage({ type: 'xhs-post-status', id: job.id });
          if (!next?.ok) throw new Error(next?.error || '无法读取采集状态');
          job = next.job;
        }
        if (job.status === 'completed') {
          label(button, '已保存 ✓');
          button.title = job.message || '已保存到 ZNote';
          showToast(job.message || '已保存到知识库');
        } else {
          const missingPage = !pageHtml && job.status === 'failed' && /平台未提供这篇作品的完整数据/.test(job.message || '');
          throw new Error(missingPage ? '当前卡片缺少完整作品数据；请打开这篇作品的详情页，再点「保存到 ZNote」' : job.status === 'failed' ? job.message : '采集仍在进行，请在 ZNote 采集记录查看');
        }
      } catch (error) {
        label(button, '重试采集');
        button.title = error.message || '采集失败';
        showToast(error.message || '采集失败，请重试');
      }
    }, true);
    return button;
  }
  function showToast(message) {
    let toast = document.querySelector('.znote-xhs-post-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'znote-xhs-post-toast';
      toast.setAttribute('role', 'status');
      document.documentElement.append(toast);
    }
    toast.textContent = `ZNote：${message}`;
    clearTimeout(toast._hideTimer);
    toast._hideTimer = setTimeout(() => toast.remove(), 6000);
  }
  function scan() {
    scanTimer = 0;
    currentPath = location.href;
    if (!enabled) return;
    for (const button of buttons) if (!button.isConnected) buttons.delete(button);
    for (const anchor of document.querySelectorAll('a[href*="/explore/"], a[href*="/discovery/item/"]')) {
      const url = workUrl(anchor.href);
      if (!url) continue;
      const card = anchor.closest('.note-item, [class*="note-item"], article');
      if (!card) continue;
      const existing = card.querySelector(':scope > .znote-xhs-post-button');
      if (existing) {
        if (!new URL(existing.dataset.znoteUrl).searchParams.has('xsec_token') && new URL(url).searchParams.has('xsec_token')) existing.dataset.znoteUrl = url;
        continue;
      }
      card.classList.add('znote-xhs-post-card');
      card.append(buttonFor(url));
    }
    const detailUrl = workUrl(location.href);
    const detail = document.querySelector('.znote-xhs-detail-button');
    if (detailUrl && !detail) document.documentElement.append(buttonFor(detailUrl, true));
    else if (!detailUrl && detail) { detail.remove(); buttons.delete(detail); }
    else if (detailUrl && detail && detail.dataset.znoteUrl !== detailUrl) {
      detail.dataset.znoteUrl = detailUrl;
      label(detail, '保存到 ZNote');
    }
  }
  function schedule() {
    if (!scanTimer) scanTimer = setTimeout(scan, 180);
  }
  async function refresh() {
    try {
      const result = await chrome.runtime.sendMessage({ type: 'media-settings' });
      enabled = result?.ok && !result.value?.blocked;
    } catch { enabled = false; }
    for (const button of buttons) if (!enabled) button.remove();
    if (!enabled) buttons.clear();
    document.querySelector('.znote-xhs-post-toast')?.remove();
    if (enabled) schedule();
  }
  chrome.runtime.onMessage.addListener(message => { if (message.type === 'media-settings-changed') refresh(); });
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  setInterval(() => { if (location.href !== currentPath) schedule(); }, 700);
  refresh();
})();
