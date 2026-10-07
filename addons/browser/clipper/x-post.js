(() => {
  if (window.top !== window) return;
  let enabled = false, timer = 0;
  function postUrl(article) {
    for (const time of article.querySelectorAll('time')) {
      if (time.closest('article') !== article || time.closest('[data-testid="quoteTweet"]')) continue;
      try {
        const url = new URL(time.closest('a[href]')?.href);
        if (/^\/[\w]+\/status\/\d+\/?$/.test(url.pathname)) return `https://x.com${url.pathname}`;
      } catch {}
    }
    return '';
  }
  function toast(message) {
    document.querySelector('.znote-post-toast')?.remove();
    const node = document.createElement('div'); node.className = 'znote-post-toast'; node.setAttribute('role', 'status');
    const text = document.createElement('span'); text.textContent = `ZNote：${message}`;
    const close = document.createElement('button'); close.textContent = '×'; close.setAttribute('aria-label', '关闭采集提示'); close.onclick = () => node.remove();
    node.append(text, close); document.documentElement.append(node); setTimeout(() => node.remove(), 8000);
  }
  function scan() {
    timer = 0; if (!enabled) return;
    for (const article of document.querySelectorAll('article[data-testid="tweet"]')) {
      const url = postUrl(article), existing = article.querySelector('.znote-x-post-button');
      if (existing?.dataset.url === url) continue;
      existing?.remove();
      const hasPhoto = [...article.querySelectorAll('[data-testid="tweetPhoto"] img')].some(img => img.closest('article') === article && !img.closest('[data-testid="quoteTweet"]') && /^https:\/\/pbs\.twimg\.com\/media\//.test(img.src));
      if (!url || !hasPhoto) continue;
      const row = article.querySelector('[role="group"]'); if (!row) continue;
      const button = document.createElement('button'); button.type = 'button'; button.className = 'znote-x-post-button'; button.dataset.url = url;
      button.textContent = '保存图组'; button.setAttribute('aria-label', '保存这条推文的全部图片到 ZNote');
      button.addEventListener('click', async event => {
        event.preventDefault(); event.stopPropagation(); if (button.disabled) return;
        button.disabled = true; button.textContent = '采集中…';
        try {
          const result = await chrome.runtime.sendMessage({ type: 'x-post-capture', url });
          if (!result?.ok) throw Error(result?.error || '提交失败');
          let job = result.job;
          for (let i = 0; i < 150 && ['queued', 'running'].includes(job.status); i++) {
            await new Promise(resolve => setTimeout(resolve, 2000));
            const next = await chrome.runtime.sendMessage({ type: 'x-post-status', id: job.id });
            if (!next?.ok) throw Error(next?.error || '无法读取采集状态'); job = next.job;
          }
          if (job.status !== 'completed') throw Error(job.status === 'failed' ? job.message : '采集仍在进行，可在 ZNote 采集记录查看');
          button.textContent = '已保存 ✓'; toast(job.message);
        } catch (e) { button.textContent = '重试采集'; toast(e.message || '采集失败'); }
        finally { button.disabled = false; }
      });
      row.append(button);
    }
  }
  function schedule() { if (!timer) timer = setTimeout(scan, 200); }
  async function refresh() {
    try { const result = await chrome.runtime.sendMessage({ type: 'media-settings' }); enabled = result?.ok && !result.value?.blocked; } catch { enabled = false; }
    if (!enabled) document.querySelectorAll('.znote-x-post-button,.znote-post-toast').forEach(node => node.remove());
    else schedule();
  }
  chrome.runtime.onMessage.addListener(message => { if (message.type === 'media-settings-changed') refresh(); });
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  refresh();
})();
