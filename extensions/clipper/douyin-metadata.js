(() => {
  if(!/(^|\.)(douyin|iesdouyin)\.com$/.test(location.hostname))return;
  const clean=(v,n=200)=>typeof v==='string'?v.replace(/\s+/g,' ').trim().slice(0,n):'';
  const idOf=value=>{try{const u=new URL(value,location.href);return u.pathname.match(/\/(?:share\/)?video\/(\d+)/)?.[1]||u.searchParams.get('modal_id')||u.searchParams.get('aweme_id')||''}catch{return ''}};
  const urlOf=value=>{if(typeof value!=='string'||!value.trim())return '';try{const u=new URL(value,location.href);u.hash='';return /^https?:$/.test(u.protocol)&&!u.username&&!u.password?u.href:''}catch{return ''}};
  const cache=new WeakMap();
  function records(){
    const result=[];
    for(const script of [...document.querySelectorAll('script#RENDER_DATA,script#__NEXT_DATA__,script[type="application/json"],script:not([src])')].slice(0,120)){
      const raw=script.textContent;if(!raw||raw.length>2000000)continue;
      if(cache.get(script)?.raw===raw){result.push(...cache.get(script).records);continue}
      let input=raw.trim(),data;const found=[];
      try{
        if(script.id==='RENDER_DATA')input=decodeURIComponent(input);
        const assignment=input.match(/(?:window|self|globalThis)\._ROUTER_DATA\s*=\s*/);
        if(assignment){input=input.slice(assignment.index+assignment[0].length);let depth=0,quoted=false,escaped=false,end=-1;for(let i=0;i<input.length;i++){const c=input[i];if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;continue}if(c==='"')quoted=true;else if(c==='{')depth++;else if(c==='}'&&--depth===0){end=i+1;break}}if(end>0)input=input.slice(0,end);}
        data=JSON.parse(input);
      }catch{cache.set(script,{raw,records:[]});continue}
      let visited=0;const walk=(value,depth=0)=>{
        if(!value||typeof value!=='object'||depth>18||visited++>12000)return;
        const id=value.aweme_id||value.awemeId,person=value.author||value.authorInfo;
        if(typeof id==='string'&&/^\d+$/.test(id)&&person&&value.video){
          const author=clean(person.nickname||person.nickName),sec=clean(person.sec_uid||person.secUid,200);
          const urls=new Set();const addresses=(v,d=0)=>{if(!v||d>6)return;if(typeof v==='string'){if(/^https?:\/\//.test(v)&&v.length<4096)urls.add(urlOf(v));return}if(Array.isArray(v)){for(const x of v.slice(0,30))addresses(x,d+1)}else if(typeof v==='object')for(const [key,x]of Object.entries(v))if(/play|download|url|bit.?rate|src/i.test(key))addresses(x,d+1)};addresses(value.video);
          found.push({id,title:clean(value.desc||value.description),author,author_url:sec?'https://www.douyin.com/user/'+encodeURIComponent(sec):'',source_url:'https://www.douyin.com/video/'+id,metadata_rank:3,urls:[...urls].filter(Boolean)});
        }
        for(const child of Object.values(value))walk(child,depth+1);
      };walk(data);cache.set(script,{raw,records:found});result.push(...found);
    }
    const unique=new Map();for(const row of result){const old=unique.get(row.id);unique.set(row.id,old?{...old,...row,author:row.author||old.author,author_url:row.author_url||old.author_url,urls:[...new Set([...old.urls,...row.urls])]}:row)}return [...unique.values()].slice(0,300);
  }
  const ignored='nav,header,[data-e2e*="comment"],[class*="comment"],[role="navigation"]';
  const nameOf=el=>clean(el?.getAttribute('title')||el?.getAttribute('data-nickname')||el?.querySelector('[data-e2e*="nickname"],[class*="nickname"]')?.textContent||el?.textContent).replace(/^@\s*/,'');
  function authorFrom(root){
    if(!root)return {};
    const exact=root.querySelector('[data-e2e="video-author-nickname"],[data-e2e="video-author-name"],[data-e2e="video-author"] a,[data-e2e="user-title"]');
    if(exact&&!exact.closest(ignored)&&nameOf(exact))return {author:nameOf(exact),author_url:urlOf(exact.closest('a')?.getAttribute('href')||'')};
    if(root===document)return {};
    const links=[...root.querySelectorAll('a[href*="/user/"]')].filter(el=>!el.closest(ignored)&&nameOf(el)&&!/^(?:关注|私信|我的|我|我的主页|个人主页|登录|立即登录)$/.test(nameOf(el)));
    const names=[...new Set(links.map(nameOf))];if(names.length===1)return {author:names[0],author_url:urlOf(links[0].getAttribute('href'))};return {};
  }
  function rootOf(video){
    let root=video?.closest('[data-e2e="feed-active-video"],[data-e2e="feed-item"],[data-e2e="feed-video"],[data-e2e="video-detail"],[data-aweme-id],[data-item-id],article');
    if(root)return root;
    for(let el=video?.parentElement,depth=0;el&&el!==document.body&&depth<12;el=el.parentElement,depth++){
      if(el.querySelectorAll('video').length>1)break;
      if(authorFrom(el).author)return el;
    }
    return document.querySelectorAll('video').length<=1?document.querySelector('main')||document:null;
  }
  const publicData=({urls,id,...value})=>value;
  // The player appends request parameters and can switch CDN hosts. The TOS
  // object path still identifies the same media; unrelated assets stay separate.
  const mediaKey=value=>{try{const u=new URL(value);if(/(^|\.)douyinvod\.com$/.test(u.hostname))return u.pathname.match(/\/video\/tos\/.+/)?.[0]||'';if(/(^|\.)douyin\.com$/.test(u.hostname)&&/^\/aweme\/v1\/play\//.test(u.pathname))return u.searchParams.get('video_id')||''}catch{}return ''};
  globalThis.ZNoteDouyinMetadataForUrl=url=>{const address=urlOf(url),key=mediaKey(address);const matches=records().filter(r=>r.urls.some(u=>u===address||(key&&mediaKey(u)===key)));return matches.length===1?publicData(matches[0]):null};
  globalThis.ZNoteDouyinMetadata=video=>{
    const root=rootOf(video),all=records(),src=urlOf(video?.currentSrc||video?.src||''),link=root?.querySelector('a[href*="/video/"]');
    const id=root?.getAttribute?.('data-aweme-id')||root?.getAttribute?.('data-item-id')||idOf(link?.href)||((!root||root===document||document.querySelectorAll('video').length<=1)?idOf(location.href):'');
    const matched=all.filter(r=>id?r.id===id:src&&r.urls.includes(src));
    const record=matched.length===1?matched[0]:!id&&all.length===1&&document.querySelectorAll('video').length<=1?all[0]:null;
    const dom=authorFrom(root),titleNode=root?.querySelector('[data-e2e="video-desc"],[data-e2e="video-detail-desc"],[data-e2e="user-post-item-desc"]');
    return {title:record?.title||clean(titleNode?.getAttribute('title')||titleNode?.textContent),author:record?.author||dom.author||'',author_url:record?.author_url||dom.author_url||'',source_url:record?.source_url||(id?'https://www.douyin.com/video/'+id:location.href),metadata_rank:3};
  };
})();
