(() => {
  const clean=(s,n=200)=>typeof s==='string'?s.replace(/\s+/g,' ').trim().slice(0,n):'';
  const text=(root,selector)=>{const el=root?.querySelector(selector);return clean(el?.getAttribute('content')||el?.getAttribute('title')||el?.textContent)};
  const safe=(value)=>{if(typeof value!=='string'||!value.trim())return '';try{const url=new URL(value,location.href);return /^https?:$/.test(url.protocol)&&!url.username&&!url.password?url.href:''}catch{return ''}};
  globalThis.ZNoteVideoMetadata=(video=null)=>{
    let title='',author='',author_url='',source_url=location.href,rank=1;
    const host=location.hostname;
    const root=video?.closest('article[data-testid="tweet"], [data-e2e="feed-active-video"], [data-e2e="feed-item"], #noteContainer, .note-detail-mask, .note-container, article')||document;
    const authorLink=selector=>{for(const el of root.querySelectorAll(selector)){const name=clean(el.textContent);if(name){author=name;author_url=safe(el.closest('a')?.getAttribute('href'));break}}};
    if(/(^|\.)bilibili\.com$/.test(host)) {title=text(document,'h1.video-title, h1');authorLink('.up-name[href], .up-info-container a[href*="space.bilibili.com"]');}
    else if(/(^|\.)xiaohongshu\.com$/.test(host)){title=text(root,'#detail-title, .title')||text(root,'#detail-desc');authorLink('.author-wrapper a.name, .author-wrapper a[href*="/user/profile/"], .author a.name, .author-wrapper .username, .author .username');}
    else if(/(^|\.)(douyin|iesdouyin)\.com$/.test(host)&&globalThis.ZNoteDouyinMetadata){const details=globalThis.ZNoteDouyinMetadata(video);title=details.title;author=details.author;author_url=details.author_url;source_url=details.source_url;}
    else if(/(^|\.)(x|twitter)\.com$/.test(host)&&root!==document){title=text(root,'[data-testid="tweetText"]');authorLink('[data-testid="User-Name"] a[href]:first-child');const time=root.querySelector('time');source_url=safe(time?.closest('a')?.href)||source_url;}
    if(title||author)rank=3;
    if(root!==document){title ||= text(root,'h1,h2,h3,[itemprop="name"]');if(!author)authorLink('[rel="author"], [itemprop="author"] a');if(title||author)rank=3;}
    const videos=[...document.querySelectorAll('video')];
    // Page-wide author data is unsafe for a feed containing several works.
    if(root===document&&videos.length<=1){
      const objects=[];const visit=(value,depth=0)=>{if(!value||depth>5||objects.length>100)return;if(Array.isArray(value)){for(const child of value.slice(0,100))visit(child,depth+1)}else if(typeof value==='object'){if([value['@type']].flat().includes('VideoObject'))objects.push(value);visit(value['@graph'],depth+1)}};
      for(const script of [...document.querySelectorAll('script[type="application/ld+json"]')].slice(0,10)){if(script.textContent.length>500000)continue;try{visit(JSON.parse(script.textContent))}catch{}}
      const data=objects.find(o=>[o.contentUrl,o.embedUrl].some(u=>u&&safe(u)===video?.currentSrc))||(objects.length===1?objects[0]:null);
      if(data){title ||= clean(data.name||data.headline);const person=[data.author||data.creator].flat()[0];author ||= clean(typeof person==='string'?person:person?.name);author_url ||= safe(person?.url);rank=2;}
      title ||= text(document,'meta[property="og:title"],meta[name="twitter:title"]');author ||= text(document,'meta[name="author"],meta[property="article:author"]');
    }
    title ||= clean(video?.getAttribute('title')||video?.getAttribute('aria-label'))||clean(document.title);
    return {title,author,author_url,source_url,metadata_rank:rank};
  };
  chrome.runtime.onMessage.addListener((message,sender,reply)=>{if(message.type!=='video-metadata')return;const video=[...document.querySelectorAll('video')].find(v=>v.currentSrc===message.url||v.src===message.url);reply(globalThis.ZNoteVideoMetadata(video));});
})();
