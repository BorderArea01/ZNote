export function blockedSite(value, config={}) {
  try {
    const url=new URL(value);
    if(!/^https?:$/.test(url.protocol))return true;
    if(config.server && url.origin===new URL(config.server).origin)return true;
    return (config.blockedSites||[]).some(rule=>{
      if(/^https?:\/\//i.test(rule))return url.origin===new URL(rule).origin;
      const host=rule.toLowerCase().replace(/^\*\./,'').replace(/\.$/,'');
      return url.hostname===host || url.hostname.endsWith('.'+host);
    });
  } catch { return true; }
}
export function parseBlockedSites(text) {
  const rules=[...new Set(text.split(/[\n,，]+/).map(s=>s.trim()).filter(Boolean))];
  if(rules.length>200)throw Error('黑名单最多 200 个网站');
  for(const rule of rules){const u=new URL(/^https?:\/\//i.test(rule)?rule:'https://'+rule.replace(/^\*\./,''));if(!/^https?:$/.test(u.protocol)||u.username||u.password||u.pathname!=='/'||u.search||u.hash||!/^[a-z\d.\-\[\]:]+$/i.test(u.hostname))throw Error('请输入域名或网站地址，每行一个，不包含路径');}
  return rules;
}
