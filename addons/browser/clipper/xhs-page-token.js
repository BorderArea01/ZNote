(() => {
  if (window.top !== window || location.hostname !== 'www.xiaohongshu.com') return;
  const validId = /^[a-f\d]{4,40}$/i;
  const validToken = /^[A-Za-z\d_-]{10,256}=?$/;
  function findToken(id) {
    const seen = new WeakSet();
    const stack = [window.__INITIAL_STATE__, window.__SETUP_SERVER_STATE__];
    let examined = 0;
    while (stack.length && examined++ < 30000) {
      const entry = stack.pop();
      if (!entry || typeof entry !== 'object' || seen.has(entry)) continue;
      seen.add(entry);
      const note = entry.noteCard || entry.note || entry;
      const noteId = note.noteId || note.note_id || entry.noteId || entry.note_id;
      const token = entry.xsecToken || entry.xsec_token || note.xsecToken || note.xsec_token;
      if (String(noteId || '') === id && typeof token === 'string' && validToken.test(token)) {
        const source = entry.xsecSource || entry.xsec_source || note.xsecSource || note.xsec_source;
        return {token,source:typeof source==='string' && /^pc_[a-z_]{2,30}$/.test(source) ? source : ''};
      }
      try { for (const child of Object.values(entry)) if (child && typeof child === 'object') stack.push(child); } catch {}
    }
    return {token:'',source:''};
  }
  window.addEventListener('znote-xhs-token-request', event => {
    const id = event.detail?.id;
    if (!validId.test(id || '')) return;
    window.dispatchEvent(new CustomEvent('znote-xhs-token-response', {detail:{id,nonce:event.detail.nonce,...findToken(id)}}));
  });
})();
