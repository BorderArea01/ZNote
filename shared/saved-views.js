export const savedViewLabels = { all: '全部内容', images: '图片素材', videos: '视频素材', notes: '图文笔记', favorites: '我的收藏', trash: '回收站' };
export function viewSignature(config) {
  return JSON.stringify([config.view, config.query, [...new Set(config.tags)].sort(), config.mode, config.sort, config.layout]);
}
