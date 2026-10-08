(() => {
  const post = value => {
    try {
      const url=new URL(value,location.href),match=url.pathname.match(/^\/([\w]+)\/status\/(\d+)(?:\/(?:photo|video)\/\d+)?\/?$/);
      return url.protocol==='https:'&&/^(?:www\.|mobile\.)?(?:x|twitter)\.com$/.test(url.hostname)&&match?{id:match[2],url:`https://x.com/${match[1]}/status/${match[2]}`} : null;
    }catch{return null;}
  };
  const own = (node,article) => {
    if(node.closest('article')!==article||node.closest('[data-testid="quoteTweet"],[data-testid="card.wrapper"]'))return false;
    // X also renders quote cards as a link container without quoteTweet.
    for(let parent=node;parent&&parent!==article;parent=parent.parentElement){
      if(parent.getAttribute('role')==='link'&&parent.querySelector('time')&&parent.querySelector('[data-testid="User-Name"]'))return false;
    }
    return true;
  };
  function read(source) {
    const target=post(source);if(!target)return null;
    for(const article of document.querySelectorAll('article[data-testid="tweet"]')){
      const links=[...article.querySelectorAll('time')].map(node=>node.closest('a[href]'));
      links.push(...[...article.querySelectorAll('[data-testid="tweetPhoto"] img')].map(node=>node.closest('a[href]')));
      // An ordinary outbound link in the body is not evidence of this
      // article's identity. Only its timestamp or own media can identify it.
      if(!links.some(link=>link&&own(link,article)&&post(link.href)?.id===target.id))continue;
      if([...article.querySelectorAll('[data-testid="tweet-text-show-more-link"]')].some(node=>own(node,article)))return {error:'请先展开这条推文的完整正文，再采集'};
      const textNode=[...article.querySelectorAll('[data-testid="tweetText"]')].find(node=>own(node,article));
      const copy=textNode?.cloneNode(true);
      if(copy){
        for(const img of copy.querySelectorAll('img[alt]'))img.replaceWith(document.createTextNode(img.getAttribute('alt')));
        for(const br of copy.querySelectorAll('br'))br.replaceWith(document.createTextNode('\n'));
        for(const anchor of copy.querySelectorAll('a[href]')){
          const href=anchor.getAttribute('href');
          if(/^https?:\/\//.test(href)&&!/https?:\/\/t\.co\//.test(href)&&/^https?:|…|\.\.\./.test(anchor.textContent))anchor.textContent=href;
        }
      }
      const text=(copy?.textContent||'').trim(),images=[];
      for(const img of article.querySelectorAll('[data-testid="tweetPhoto"] img')){
        if(!own(img,article)||img.closest('[data-testid="videoPlayer"]'))continue;
        try{const url=new URL(img.currentSrc||img.src);if(url.protocol==='https:'&&url.hostname==='pbs.twimg.com'&&url.pathname.startsWith('/media/')){
          url.searchParams.set('name','orig');if(!images.includes(url.href))images.push(url.href);
        }}catch{}
      }
      const video=[...article.querySelectorAll('video,[data-testid="videoPlayer"]')].some(node=>own(node,article));
      // Never archive just text while the post's gated media is unavailable.
      const photoSlots=[...article.querySelectorAll('[data-testid="tweetPhoto"]')].filter(node=>own(node,article));
      if(photoSlots.length>images.length||[...article.querySelectorAll('[data-testid="sensitiveMediaWarning"]')].some(node=>own(node,article)))return {error:'请先在原帖中显示全部媒体，再采集'};
      if(!text&&!images.length&&!video)return null;
      const user=[...article.querySelectorAll('[data-testid="User-Name"]')].find(node=>own(node,article));
      const lines=(user?.innerText||user?.textContent||'').split('\n').map(s=>s.trim()).filter(Boolean);
      const screen_name=lines.join(' ').match(/@([\w]+)/)?.[1]||new URL(target.url).pathname.split('/')[1];
      return {id:target.id,text,images,author:{name:lines.find(s=>!s.startsWith('@'))||'',screen_name},video};
    }
    return null;
  }
  globalThis.ZNoteXPostReader={read,own};
})();
