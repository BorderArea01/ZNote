(() => {
  if (window.top !== window || globalThis.__znoteXPostReady) return;
  globalThis.__znoteXPostReady=true;
  let enabled = false, timer = 0, pageButton;
  const reconnect='扩展后台未响应，请在扩展管理页重新加载「ZNote · 网页采集」，再刷新本页';
  async function request(type,extra={}) {
    for(let attempt=0;attempt<2;attempt++){
      let result;
      try { result=await chrome.runtime.sendMessage({target:'background',type,...extra}); }
      catch(error){if(/context invalidated|receiving end|message port|channel closed/i.test(error.message||''))throw Error(reconnect);throw error;}
      if(result){if(!result.ok)throw Error(result.error||'扩展后台返回了无效响应，请重新加载扩展');return result;}
      if(!attempt)await new Promise(resolve=>setTimeout(resolve,250));
    }
    throw Error(reconnect);
  }
  function postUrl(article) {
    // Detail pages do not always render a <time>. Photo anchors carry the
    // exact post ID too; never fall back to the page URL for a different card.
    const candidates=[...article.querySelectorAll('time')].map(time=>time.closest('a[href]'));
    candidates.push(...[...article.querySelectorAll('[data-testid="tweetPhoto"] img')].map(img=>img.closest('a[href]')));
    candidates.push(...article.querySelectorAll('a[href]'));
    for (const link of candidates) {
      if (!link || link.closest('article') !== article || link.closest('[data-testid="quoteTweet"],[data-testid="card.wrapper"]')) continue;
      try {
        const url = new URL(link.href),match=url.pathname.match(/^\/([\w]+)\/status\/(\d+)(?:\/(?:photo|video)\/\d+)?\/?$/);
        if (/^(?:www\.|mobile\.)?(?:x|twitter)\.com$/.test(url.hostname)&&match) return `https://x.com/${match[1]}/status/${match[2]}`;
      } catch {}
    }
    return '';
  }
  function toast(message,error=false) {
    globalThis.ZNotePageTools?.notice(message,{error,key:'post'});
  }
  function createButton(url) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'znote-x-post-button'; button.dataset.url = url;
      button.textContent = '保存图组'; button.setAttribute('aria-label', '保存这条推文的全部图片到 ZNote');
      button.addEventListener('click', async event => {
        event.preventDefault(); event.stopPropagation(); if (!event.isTrusted || button.disabled) return;
        button.disabled = true; button.textContent = '采集中…';
        const started=Date.now();globalThis.ZNotePageTools?.progress('正在提交本帖…');
        try {
          const ready=await request('znote-post-ready');
          if(ready.protocol!==1)throw Error(reconnect);
          const result = await request('x-post-capture',{url});
          let job = result.job;
          if(!job?.id||!job.status)throw Error('扩展未返回采集任务，请重新加载扩展后重试');
          for (let i = 0; i < 150 && ['queued', 'running'].includes(job.status); i++) {
            globalThis.ZNotePageTools?.progress(job.message||'等待服务器采集',{elapsed:Math.floor((Date.now()-started)/1000)});
            await new Promise(resolve => setTimeout(resolve, 2000));
            const next = await request('x-post-status',{id:job.id});
            if(!next.job?.status)throw Error('扩展未返回任务状态，可在 ZNote 采集记录查看');job = next.job;
          }
          if (job.status !== 'completed') throw Error(job.status === 'failed' ? job.message : '采集仍在进行，可在 ZNote 采集记录查看');
          button.textContent = '已保存 ✓'; toast(job.message);
        } catch (e) { button.textContent = '重试采集'; toast(e.message || '采集失败',true); }
        finally { button.disabled = false; }
      });
      return button;
  }
  function scan() {
    timer = 0; if (!enabled) return;
    const match=location.pathname.match(/^\/([\w]+)\/status\/(\d+)(?:\/(?:photo|video)\/\d+)?\/?$/);
    const detail=match?`https://x.com/${match[1]}/status/${match[2]}`:'';
    if(pageButton?.dataset.url!==detail||pageButton&&!pageButton.isConnected){pageButton?.remove();pageButton=null;globalThis.ZNotePageTools?.clear('post');}
    if(detail&&!pageButton){pageButton=createButton(detail);pageButton.id='znote-x-page-button';pageButton.classList.add('znote-x-page-button');pageButton.textContent='ZNote · 保存本帖';globalThis.ZNotePageTools?.register('post',pageButton);}
    for (const article of document.querySelectorAll('article[data-testid="tweet"]')) {
      const url = postUrl(article), existing = article.querySelector('.znote-x-post-button');
      if (url!==detail&&existing?.dataset.url === url) continue;
      existing?.remove();
      const hasPhoto = [...article.querySelectorAll('[data-testid="tweetPhoto"] img')].some(img => img.closest('article') === article && !img.closest('[data-testid="quoteTweet"]') && /^https:\/\/pbs\.twimg\.com\/media\//.test(img.src));
      if (!url || !hasPhoto || url===detail) continue;
      const row = [...article.querySelectorAll('[role="group"]')].find(node=>node.closest('article')===article&&!node.closest('[data-testid="quoteTweet"]'));
      const button=createButton(url);
      // Standalone detail pages may omit the normal action group while loading.
      // Keep a visible in-page control beside the post's own text/media.
      if(row)row.append(button);
      else {
        const text=[...article.querySelectorAll('[data-testid="tweetText"]')].find(node=>!node.closest('[data-testid="quoteTweet"]'));
        const photo=[...article.querySelectorAll('[data-testid="tweetPhoto"]')].find(node=>!node.closest('[data-testid="quoteTweet"]'));
        const anchor=text||photo;if(anchor)anchor.insertAdjacentElement('afterend',button);
      }
    }
  }
  function schedule() { if (!timer) timer = setTimeout(scan, 200); }
  async function refresh() {
    try { const result = await chrome.runtime.sendMessage({ type: 'media-settings' }); enabled = result?.ok && !result.value?.blocked; } catch { enabled = false; }
    if (!enabled) {document.querySelectorAll('.znote-x-post-button').forEach(node=>node.remove());pageButton?.remove();pageButton=null;globalThis.ZNotePageTools?.clear('post');}
    else schedule();
  }
  chrome.runtime.onMessage.addListener(message => { if (message.type === 'media-settings-changed') refresh();if(message.type==='media-page-changed')schedule(); });
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  refresh();
})();
