# 建筑故障主题

可在「设置与连接 → 外观 → 建筑故障」选择，保留所有旧主题与明暗模式。Android 的「界面与图标」入口同步原生面板、浮窗和桌面图标；账号、连接、任务及媒体文件不随外观变化。

Windows 启动页同样提供「界面与图标」，与知识库页的选择双向同步，并更换窗口及托盘图标。安装包与系统快捷方式保留经典图标，避免为外观变更重写用户快捷方式。

摄影素材使用内置 imagegen 生成，原始文件为 `architecture-source.png`。生成提示：

> 建筑摄影，故障艺术 Glitch Art，强烈横向像素排序，水平撕裂拉伸畸变，建筑破碎成大量水平条状碎片，像素碎块在空中飘散，数据熔合 datamoshing 效果，保留建筑整体轮廓可识别，晴朗蓝天背景，自然日光，写实照片基底，数字文件损坏效果，零散漂浮的小像素方块，轻微 RGB 色偏，高细节，电影感画面。白色混凝土现代建筑，横向构图，无文字、人物或 UI；保持可用于宽横幅与手机裁切的天空和建筑轮廓。

`scripts/build-glitch-assets.mjs` 生成桌面与手机 WebP、Android 小尺寸背景和替代图标。手写 Z 延续原字形，只对中间一条做横向错位及轻微 RGB 分离；原 `public/icon.svg` 保留。主题不改变用户图片或视频像素，空闲无循环故障动画，支持减少动态效果。Android 背景位图复用缓存，不在拖动期间读取网络或重新解码。

实现依据：[Android activity-alias](https://developer.android.com/guide/topics/manifest/activity-alias-element)、[减少动态效果](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/%40media/prefers-reduced-motion)、[装饰图片优化](https://developer.chrome.com/docs/modern-web-guidance/guides/performance/deliver-optimized-decorative-images)。
