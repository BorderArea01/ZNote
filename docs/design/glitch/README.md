# 建筑故障主题

## 当前交互规范（2026-10-31 用户最新要求）

静止时保持完整容器、按钮、图标和摄影，没有碎边、散点或预先烘焙的撕裂。动态模式只在鼠标进入时播放一次 640 ms 故障；停留不重复，离开再进入可再次触发。触屏触碰与键盘按钮操作保留等价反馈。静态模式和系统减少动态效果均不触发。此规范替代下文历史迭代中的常驻碎边和自动循环。

取消 `steps(1,end)` 与无限循环，使用连续的位移/拉伸、横向扫描裁切和透明度插值；仅触发目标创建纯文本副本与碎片，结束、离屏或禁用后释放。闲置不建立片段 DOM、不渲染故障滤镜；不设置低频定时器，也不以录屏补帧冒充界面帧率。浏览器实际刷新率由设备决定。

干净底图由内置 image_gen 工具生成，保存为 [architecture-clean-source.png](architecture-clean-source.png)，压缩版为 `public/themes/glitch/architecture-clean.webp` 与 `architecture-clean-mobile.webp`。原摄影素材保留用于历史追溯；新网页、Pages 和 Windows 启动页源码使用干净版本。原生客户端安装包需独立验收发布，本轮没有发布安装包。

生成提示（内置工具模式）：

> Create one photorealistic architectural background photograph for the ZNote app. A sculptural modern white concrete and glass building with long horizontal cantilevered volumes under a clear brilliant blue sky and soft white summer cumulus clouds, crisp natural daylight, subtle realistic concrete texture and clean glass reflections, cinematic architectural photography, wide landscape 16:9 composition usable as a panoramic strip with architectural silhouette across the middle. The photograph must be completely pristine and physically coherent: NO glitch, NO tearing, NO datamoshing, NO displaced stripes, NO floating fragments, NO chromatic aberration, NO artificial pixels, NO grain effects, NO text or logo, NO people, NO UI. Restrained elegant editorial photography, natural colors.

连续插值依据 [animation-timing-function](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/animation-timing-function)，鼠标跨越子元素的重复事件依据 [pointerover](https://developer.mozilla.org/en-US/docs/Web/API/Element/pointerover_event) 的边界行为处理。没有移动真实命中区域、复制可聚焦控件或修改用户媒体。

## 历史迭代记录

可在「设置与连接 → 外观 → 建筑故障」选择，保留所有旧主题与明暗模式。Android 的「界面与图标」入口同步原生面板、浮窗和桌面图标；账号、连接、任务及媒体文件不随外观变化。

Windows 启动页同样提供「界面与图标」，与知识库页的选择双向同步，并更换窗口及托盘图标。安装包与系统快捷方式保留经典图标，避免为外观变更重写用户快捷方式。

2026-10-31 用户补充的方向：

> 故障艺术 Glitch Art，强烈横向像素排序，水平撕裂拉伸畸变，按钮与容器破碎成大量水平条状碎片，像素碎块在空中飘散，数据熔合 datamoshing 效果，保留按钮与容器整体轮廓可识别，晴朗蓝天背景，自然日光，写实照片基底，数字文件损坏效果，零散漂浮的小像素方块，轻微 RGB 色偏，高细节，电影感画面。

第二轮把效果从横幅延伸到控件本身：以不规则横向遮罩、错位背景条、分离像素和 RGB 边缘组成按钮与容器，悬停时一次短暂撕裂与飘散。`public/themes/glitch/fragments.css` 由网页、Windows 连接页与远程采集页复用；Android 使用原生 Canvas 绘制相同的条带与碎片，避免每帧解码或启动 WebView。继续复用原摄影底图，不把 UI 烘焙成不可交互的图片。文字、焦点、命中区域、滚动和原媒体不随装饰移动。

第三轮依据用户提供的蓝天白云界面参考修正：去掉等距彩色描边、重复横线及规则方块；面板底色本身形成破碎轮廓，再在边界交错显示摄影材质。不同边缘的条带高度、宽度、密度与聚集位置不相同，中心阅读区保持完整。`scripts/build-glitch-fragments.mjs` 用固定种子生成静态 SVG alpha 遮罩，输出 `fragment-masks.css`；网页、Windows 启动页和 Pages 复用同一文件，既不运行每帧脚本，也不对媒体施加滤镜。深色模式同样去除完整矩形底色。原生 Android 按 bounds 变化重建缓存 Path，绘制真实面板轮廓和局部摄影碎片，移除旧的六条等距色线；构建通过不能替代原生界面验收。

控件边缘的处理基于 [CSS mask-image](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/mask-image) 与 [mask-composite](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/mask-composite)，只应用于不接收输入的装饰层。桌面启动页 CSP 单独允许本地 data 图片以加载 SVG 遮罩，不开放脚本或外部连接。

用户进一步否定「静态边缘、悬停小幅抖动」，明确要求酷炫的数据熔断动态。当前动态模式使用 `rupture.svg` 的分段位移场切开实际面板材质，再做水平像素拖长、RGB 拆分和重组；独立条带与像素块从容器内部拉开、飞散、消失，横幅摄影有大幅分段错位。它模拟文件损坏的视觉，不改变用户媒体编码或像素。生成器为 `scripts/build-glitch-rupture.mjs`；不是将一段视频贴到界面上。

「主题动效」提供动态和静态选择。`motion.js` 以 IntersectionObserver 和页面可见事件控制 CSS 动画，仅为可见容器创建装饰片段；布局、点击位置与可访问名称不动，没有每帧 DOM 截图、Canvas 循环或网络视频。减少动态效果时静止。飞散片段在页面边界裁切，不能撑出横向滚动条，也不能给媒体预览新增 transform/paint containment 祖先。Playwright 的浏览器/Electron loader 禁用了后台节流，本轮自动化只记录真实可见事件历史，不能把合成事件说成真机后台验证。

本轮先交付真实页面与录屏以核对动态方向，Windows29 连接页与动效设置为源码候选，没有发布新安装包；安卓原生浮窗同样未发布新 APK。

第四轮参考用户提供的[知乎文章](https://zhuanlan.zhihu.com/p/384808252)。知乎直接访问返回 403，实际阅读的是作者 Dragonir 的[同篇原文](https://www.cnblogs.com/dragonir/p/14878001.html)：借鉴 `clip-path` 动态分片、内容副本错位、短暂 RGB 色差再复原的原理，自行实现，不复制其示例代码或配图。保留蓝天与建筑摄影色调，不套用示例的黄红配色。

`signal-replay` 在可见面板/按钮内重放实际标题和按钮文字的水平切片，替代只有外围碎屑晃动的观感。装饰只包含纯文本，不克隆输入框、链接、媒体、ID 或事件；`aria-hidden`、`inert` 与 `pointer-events:none` 保持辅助技术、焦点和点击路径。文本/尺寸变化后重采样，过滤自身 DOM 变更防止观察器循环，离屏、静态或减少动态效果时移除副本。摄影撕裂、分段材质和独立碎块继续保留，预览中的用户图片不作故障处理。

摄影素材使用内置 imagegen 生成，原始文件为 `architecture-source.png`。生成提示：

> 建筑摄影，故障艺术 Glitch Art，强烈横向像素排序，水平撕裂拉伸畸变，建筑破碎成大量水平条状碎片，像素碎块在空中飘散，数据熔合 datamoshing 效果，保留建筑整体轮廓可识别，晴朗蓝天背景，自然日光，写实照片基底，数字文件损坏效果，零散漂浮的小像素方块，轻微 RGB 色偏，高细节，电影感画面。白色混凝土现代建筑，横向构图，无文字、人物或 UI；保持可用于宽横幅与手机裁切的天空和建筑轮廓。

`scripts/build-glitch-assets.mjs` 生成桌面与手机 WebP、Android 小尺寸背景和替代图标。手写 Z 延续原字形，只对中间一条做横向错位及轻微 RGB 分离；原 `public/icon.svg` 保留。主题不改变用户图片或视频像素；动态模式保留可见区域的间歇撕裂，静态和减少动态效果时停止。Android 背景位图复用缓存，不在拖动期间读取网络或重新解码。

实现依据：[Android activity-alias](https://developer.android.com/guide/topics/manifest/activity-alias-element)、[减少动态效果](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/%40media/prefers-reduced-motion)、[装饰图片优化](https://developer.chrome.com/docs/modern-web-guidance/guides/performance/deliver-optimized-decorative-images)。
