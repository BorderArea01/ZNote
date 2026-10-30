# 建筑故障主题

可在「设置与连接 → 外观 → 建筑故障」选择，保留所有旧主题与明暗模式。Android 的「界面与图标」入口同步原生面板、浮窗和桌面图标；账号、连接、任务及媒体文件不随外观变化。

Windows 启动页同样提供「界面与图标」，与知识库页的选择双向同步，并更换窗口及托盘图标。安装包与系统快捷方式保留经典图标，避免为外观变更重写用户快捷方式。

2026-10-31 用户补充的方向：

> 故障艺术 Glitch Art，强烈横向像素排序，水平撕裂拉伸畸变，按钮与容器破碎成大量水平条状碎片，像素碎块在空中飘散，数据熔合 datamoshing 效果，保留按钮与容器整体轮廓可识别，晴朗蓝天背景，自然日光，写实照片基底，数字文件损坏效果，零散漂浮的小像素方块，轻微 RGB 色偏，高细节，电影感画面。

第二轮把效果从横幅延伸到控件本身：以不规则横向遮罩、错位背景条、分离像素和 RGB 边缘组成按钮与容器，悬停时一次短暂撕裂与飘散。`public/themes/glitch/fragments.css` 由网页、Windows 连接页与远程采集页复用；Android 使用原生 Canvas 绘制相同的条带与碎片，避免每帧解码或启动 WebView。继续复用原摄影底图，不把 UI 烘焙成不可交互的图片。文字、焦点、命中区域、滚动和原媒体不随装饰移动。

第三轮依据用户提供的蓝天白云界面参考修正：去掉等距彩色描边、重复横线及规则方块；面板底色本身形成破碎轮廓，再在边界交错显示摄影材质。不同边缘的条带高度、宽度、密度与聚集位置不相同，中心阅读区保持完整。`scripts/build-glitch-fragments.mjs` 用固定种子生成静态 SVG alpha 遮罩，输出 `fragment-masks.css`；网页、Windows 启动页和 Pages 复用同一文件，既不运行每帧脚本，也不对媒体施加滤镜。深色模式同样去除完整矩形底色。原生 Android 按 bounds 变化重建缓存 Path，绘制真实面板轮廓和局部摄影碎片，移除旧的六条等距色线；构建通过不能替代原生界面验收。

控件边缘的处理基于 [CSS mask-image](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/mask-image) 与 [mask-composite](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/mask-composite)，只应用于不接收输入的装饰层。桌面启动页 CSP 单独允许本地 data 图片以加载 SVG 遮罩，不开放脚本或外部连接。

摄影素材使用内置 imagegen 生成，原始文件为 `architecture-source.png`。生成提示：

> 建筑摄影，故障艺术 Glitch Art，强烈横向像素排序，水平撕裂拉伸畸变，建筑破碎成大量水平条状碎片，像素碎块在空中飘散，数据熔合 datamoshing 效果，保留建筑整体轮廓可识别，晴朗蓝天背景，自然日光，写实照片基底，数字文件损坏效果，零散漂浮的小像素方块，轻微 RGB 色偏，高细节，电影感画面。白色混凝土现代建筑，横向构图，无文字、人物或 UI；保持可用于宽横幅与手机裁切的天空和建筑轮廓。

`scripts/build-glitch-assets.mjs` 生成桌面与手机 WebP、Android 小尺寸背景和替代图标。手写 Z 延续原字形，只对中间一条做横向错位及轻微 RGB 分离；原 `public/icon.svg` 保留。主题不改变用户图片或视频像素，空闲无循环故障动画，支持减少动态效果。Android 背景位图复用缓存，不在拖动期间读取网络或重新解码。

实现依据：[Android activity-alias](https://developer.android.com/guide/topics/manifest/activity-alias-element)、[减少动态效果](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/%40media/prefers-reduced-motion)、[装饰图片优化](https://developer.chrome.com/docs/modern-web-guidance/guides/performance/deliver-optimized-decorative-images)。
