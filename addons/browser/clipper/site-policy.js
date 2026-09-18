function parsedWebUrl(value) {
  try {
    const url = new URL(value);
    return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url : null;
  } catch { return null; }
}

function ruleMatches(url, rule) {
  try {
    if (/^https?:\/\//i.test(rule)) return url.origin === new URL(rule).origin;
    const host = String(rule).toLowerCase().replace(/^\*\./, '').replace(/\.$/, '');
    const current = url.hostname.toLowerCase();
    return current === host || current.endsWith('.' + host);
  } catch { return false; }
}

export function siteRuleFor(value) {
  const url = parsedWebUrl(value);
  if (!url) return null;
  // A custom port is a separate local/staging service. Keep its rule scoped to
  // the exact origin; ordinary sites block the hostname and its subdomains.
  return url.port ? url.origin : url.hostname.toLowerCase();
}

export function matchingBlockedSites(value, rules = []) {
  const url = parsedWebUrl(value);
  if (!url) return [];
  return rules.filter(rule => ruleMatches(url, rule));
}

export function siteControlState(value, config = {}) {
  const url = parsedWebUrl(value), rule = siteRuleFor(value);
  if (!url || !rule) return { supported: false, blocked: true, automatic: false, rule: null, matching: [], direct: [], other: [] };
  let automatic = false;
  try { automatic = !!config.server && url.origin === new URL(config.server).origin; } catch { automatic = true; }
  const matching = matchingBlockedSites(value, Array.isArray(config.blockedSites) ? config.blockedSites : []);
  const direct = matching.filter(entry => {
    if (/^https?:\/\//i.test(entry)) {
      try { return new URL(entry).origin === url.origin; } catch { return false; }
    }
    if (url.port) return false;
    return entry.toLowerCase().replace(/^\*\./, '').replace(/\.$/, '') === url.hostname.toLowerCase();
  });
  const directSet = new Set(direct);
  return { supported: true, blocked: automatic || matching.length > 0, automatic, rule, matching, direct, other: matching.filter(entry => !directSet.has(entry)) };
}

export function toggleSiteBlock(value, config = {}) {
  const state = siteControlState(value, config);
  const blockedSites = Array.isArray(config.blockedSites) ? config.blockedSites : [];
  if (!state.supported) return { ...state, changed: false, blockedSites };
  if (state.automatic) return { ...state, changed: false, blockedSites };
  if (state.direct.length) {
    const remove = new Set(state.direct);
    const next = blockedSites.filter(rule => !remove.has(rule));
    return { ...siteControlState(value, { ...config, blockedSites: next }), changed: true, blockedSites: next };
  }
  if (state.blocked) return { ...state, changed: false, blockedSites };
  const next = [...blockedSites, state.rule];
  if (next.length > 200) throw new Error('黑名单最多 200 个网站');
  return { ...siteControlState(value, { ...config, blockedSites: next }), changed: true, blockedSites: next };
}

export function blockedSite(value, config={}) {
  const url = parsedWebUrl(value);
  if (!url) return true;
  try {
    if (config.server && url.origin === new URL(config.server).origin) return true;
    return matchingBlockedSites(value, Array.isArray(config.blockedSites) ? config.blockedSites : []).length > 0;
  } catch { return true; }
}
export function parseBlockedSites(text) {
  const rules=[...new Set(text.split(/[\n,，]+/).map(s=>s.trim()).filter(Boolean))];
  if(rules.length>200)throw Error('黑名单最多 200 个网站');
  for(const rule of rules){const u=new URL(/^https?:\/\//i.test(rule)?rule:'https://'+rule.replace(/^\*\./,''));if(!/^https?:$/.test(u.protocol)||u.username||u.password||u.pathname!=='/'||u.search||u.hash||!/^[a-z\d.\-\[\]:]+$/i.test(u.hostname))throw Error('请输入域名或网站地址，每行一个，不包含路径');}
  return rules;
}
