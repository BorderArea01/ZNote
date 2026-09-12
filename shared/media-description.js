// Hide only machine-generated metadata lines; keep user Markdown and links intact.
export function mediaDescription(content='') {
  return content.split('\n').filter(line=>!/^来源链接：https?:\/\//.test(line.trim()) && !/^(原文件|图片地址)：https?:\/\//.test(line.trim()) && !/^(Pixiv ID|页码|作品标签|发布日期)：/.test(line.trim())).join('\n').replace(/\n{3,}/g,'\n\n').trim();
}
