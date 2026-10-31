# ZNote 品牌图标

2026-10-31 用户要求：图标保留故障风格，作为全局默认，不随皮肤切换。界面容器的“静止完整、悬停才撕裂”不适用于品牌图标。不要再次改回普通 Z，或只在建筑故障皮肤中使用此图标。

唯一可编辑母版为 [public/icon.svg](../../../public/icon.svg)。保留流畅手写 Z，以较细笔画、蓝色渐变、两处局部横向切片与有限青粉色差表现故障；不添加满屏散点、随机碎块或低清摄影纹理。16–32 像素首先保证字形识别，较大尺寸展示切片细节。

执行 `npm run clients:icons` 生成网页/PWA、Apple touch、Windows PNG/多尺寸 ICO、浏览器采集扩展与 Android 图标；`public/themes/glitch/icon.svg`、桌面 `icon-glitch.png` 与 Android `ic_glitch.png` 仅为兼容旧资源引用的同图别名，不能分别编辑。`scripts/build-client-icons.mjs` 是图标输出的唯一所有者，主题摄影构建不再写图标。

PWA maskable 图标填满正方形背景，Z 位于中心安全圆内。Android 默认 `ic_launcher.xml` 引用同一母版生成的 512 像素 `ic_brand.png`，保留渐变与切片；不再用只支持单一路径的矢量近似丢弃故障细节。桌面窗口/托盘统一使用默认母版，不因风格变化更换品牌。旧 APK/安装包不会因更新源码而自动更新，需要独立构建、验收与发布。

验收包含 `tests/brand-icons.mjs` 的多端输出一致、maskable 不透明/安全圆、多尺寸 ICO 解码，以及桌面/触屏真实页面的五种风格切换、登录页、favicon 与 PWA 下载字节。小尺寸排版目视结果保存在 `artifacts/brand-icons/sizes.png`。
