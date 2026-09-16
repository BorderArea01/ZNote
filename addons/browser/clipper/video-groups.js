(() => {
  globalThis.ZNoteVideoGroups=resources=>{
    const groups=new Map();
    for(const resource of resources){
      if(!['video','hls'].includes(resource.kind))continue;
      let key=resource.id;
      try{const source=new URL(resource.source_url);if(/(^|\.)douyin\.com$/.test(source.hostname)&&/^\d+$/.test(resource.work_id||''))key='douyin:'+resource.work_id}catch{}
      if(!groups.has(key))groups.set(key,{key,items:[]});
      groups.get(key).items.push(resource);
    }
    return [...groups.values()].map(group=>{
      const score=r=>{try{const u=new URL(r.url);return (u.hostname.endsWith('.douyinvod.com')?100:0)+(r.author?10:0)+(r.poster?5:0)}catch{return 0}};
      group.items.sort((a,b)=>score(b)-score(a));
      return {...group,primary:group.items[0]};
    });
  };
})();
