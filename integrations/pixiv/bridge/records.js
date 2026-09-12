// ZNote integration, GPL-3.0-or-later.
export const pximg = value => {
  const u = new URL(value);
  if (u.protocol !== 'https:' || !/(^|\.)pximg\.net$/.test(u.hostname) || u.username || u.password || u.href.length > 4096) throw Error('Pixiv 媒体地址无效');
  return u.href;
};
export function normalize(record) {
  const id = String(record.idNum || String(record.id).split('_')[0]);
  if (!/^\d{1,12}$/.test(id) || ![0,1,2,3].includes(record.type)) throw Error('作品编号或类型无效');
  const index = Number(record.index || 0);
  if (!Number.isInteger(index) || index < 0 || index > 10000) throw Error('作品页码无效');
  const text = (value, max) => String(value || '').slice(0, max);
  const out = { key: `${record.type === 3 ? 'novel' : 'art'}:${id}:${index}`, id, index, type: record.type,
    title: text(record.title, 180), author: text(record.user || record.novelMeta?.userName, 100), authorId: /^\d+$/.test(String(record.userId)) ? String(record.userId) : '',
    tags: (record.tags || []).filter(t => typeof t === 'string').slice(0,100).map(t => t.slice(0,100)),
    description: text(record.description, 80000), date: text(record.date, 40), pages: Math.max(1, Number(record.pageCount) || 1),
    source: record.type === 3 ? `https://www.pixiv.net/novel/show.php?id=${id}` : `https://www.pixiv.net/artworks/${id}`,
    original: record.type === 3 ? '' : pximg(record.original), preview: '', status: 'pending' };
  try { out.preview = pximg(record.regular || record.thumb); } catch {}
  if (record.type === 3) {
    if (typeof record.novelMeta?.content !== 'string' || record.novelMeta.content.length > 400000) throw Error('小说正文缺失或超过 40 万字符');
    out.novel = record.novelMeta.content;
    out.embedded = Object.fromEntries(Object.entries(record.novelMeta.embeddedImages || {}).slice(0,200).map(([id,url]) => [/^\d+$/.test(id) ? id : '', pximg(url)]).filter(([id]) => id));
    try { out.cover = pximg(record.novelMeta.coverUrl); } catch {}
  }
  if (record.type === 2) {
    const frames = record.ugoiraInfo?.frames;
    if (!Array.isArray(frames) || !frames.length || frames.length > 500) throw Error('动图入库支持 1～500 帧；更大作品仍可用原下载器保存');
    out.frames = frames.map(f => {
      if (!/^[\w.-]+\.(jpe?g|png)$/i.test(f.file) || !Number.isFinite(f.delay) || f.delay <= 0 || f.delay > 65535) throw Error('动图帧信息无效');
      return { file: f.file, delay: f.delay };
    });
  }
  return out;
}
