(() => {
  if (window.top !== window || location.hostname !== 'www.xiaohongshu.com') return;
  const validId = /^[a-f\d]{4,40}$/i;
  const validToken = /^[A-Za-z\d_-]{10,256}=?$/;
  function findToken(id) {
    const seen = new WeakSet();
    const stack = [window.__INITIAL_STATE__, window.__SETUP_SERVER_STATE__];
    let examined = 0;
    let record = null;
    let access = null;
    while (stack.length && examined++ < 30000) {
      const entry = stack.pop();
      if (!entry || typeof entry !== 'object' || seen.has(entry)) continue;
      seen.add(entry);
      const note = entry.noteCard || entry.note || entry;
      const noteId = note.noteId || note.note_id || entry.noteId || entry.note_id;
      const token = entry.xsecToken || entry.xsec_token || note.xsecToken || note.xsec_token;
      if (String(noteId || '') === id &&
          (Array.isArray(note.imageList) || Array.isArray(note.image_list) || note.type === 'video') &&
          !record) record = note;
      if (String(noteId || '') === id && typeof token === 'string' && validToken.test(token)) {
        const source = entry.xsecSource || entry.xsec_source || note.xsecSource || note.xsec_source;
        access = {token,source:typeof source==='string' && /^pc_[a-z_]{2,30}$/.test(source) ? source : ''};
      }
      try { for (const child of Object.values(entry)) if (child && typeof child === 'object') stack.push(child); } catch {}
    }
    // A detail opened through the SPA may exist only in the live state: its
    // original inline script still describes the earlier feed page.
    let detail = '';
    if (record && /^\/(?:explore|discovery\/item)\//.test(location.pathname) && location.pathname.includes(id)) {
      try {
        const json = JSON.stringify({note:record});
        if (json.length < 1200000) detail = json;
      } catch {}
    }
    return {...(access || {token:'',source:''}),detail};
  }
  window.addEventListener('znote-xhs-token-request', event => {
    const id = event.detail?.id;
    if (!validId.test(id || '')) return;
    window.dispatchEvent(new CustomEvent('znote-xhs-token-response', {detail:{id,nonce:event.detail.nonce,...findToken(id)}}));
  });
})();
