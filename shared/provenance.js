const sites = [
  ['小红书', ['xiaohongshu.com', 'xhslink.com']],
  ['b站', ['bilibili.com', 'b23.tv']],
  ['抖音', ['douyin.com', 'iesdouyin.com']],
  ['X', ['x.com', 'twitter.com']],
  ['微博', ['weibo.com', 'weibo.cn']],
  ['知乎', ['zhihu.com']],
  ['YouTube', ['youtube.com', 'youtu.be']],
  ['Pinterest', ['pinterest.com', 'pin.it']],
  ['Pixiv', ['pixiv.net']],
  ['E-Hentai', ['e-hentai.org', 'exhentai.org']],
  ['Pawchive', ['pawchive.pw', 'pawchive.st']],
];
export function sourceSite(value) {
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null;
    const host = url.hostname.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
    const site = sites.find(([, domains]) => domains.some(domain => host === domain || host.endsWith('.' + domain)));
    return site?.[0] || (host.length <= 40 ? host : host.slice(0, 39) + '…');
  } catch { return null; }
}
// Duplicate captures retain all source URLs in ordinary, exportable remarks.
export function sourceLinks(item) {
  const urls = [item.source_url, ...(item.content || '').split('\n')
    .filter(line => line.startsWith('来源链接：')).map(line => line.slice(5).trim())];
  return [...new Set(urls.filter(url => sourceSite(url)))].map(url => ({ url, site: sourceSite(url) }));
}
