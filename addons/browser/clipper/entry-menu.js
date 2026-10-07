// One menu tree; background.js retains the handlers and storage ownership.
export function contextMenuEntries() {
  const all=['page','image','video','link','selection'];
  return [
    {id:'znote-root',title:'ZNote · 保存与采集',contexts:all,documentUrlPatterns:['http://*/*','https://*/*']},
    {id:'znote-work',parentId:'znote-root',title:'采集当前作品',contexts:['page']},
    {id:'znote-image',parentId:'znote-root',title:'保存高清原图',contexts:['image']},
    {id:'znote-image-current',parentId:'znote-root',title:'保存当前图片版本',contexts:['image']},
    {id:'znote-gallery-link',parentId:'znote-root',title:'采集链接中的图组',contexts:['link']},
    {id:'znote-article',parentId:'znote-root',title:'保存页面正文',contexts:['page','selection']},
    {id:'znote-shot-menu',parentId:'znote-root',title:'截图',contexts:['page']},
    {id:'znote-capture-region',parentId:'znote-shot-menu',title:'框选区域',contexts:['page']},
    {id:'znote-capture',parentId:'znote-shot-menu',title:'可见页面',contexts:['page']},
    {id:'znote-media-menu',parentId:'znote-root',title:'视频',contexts:['page','link','video']},
    {id:'znote-video',parentId:'znote-media-menu',title:'解析当前作品视频',contexts:['page','video']},
    {id:'znote-video-link',parentId:'znote-media-menu',title:'解析链接中的视频',contexts:['link']},
    {id:'znote-video-file',parentId:'znote-media-menu',title:'保存当前视频文件',contexts:['video']},
  ];
}
