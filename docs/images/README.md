# README 展示素材

- `hero.svg`：为 ZNote 编写的矢量封面，表达收集、整理与留存，不是产品界面截图。
- `showcase-*.png`：ZNote 0.9.31 的真实界面截图，使用独立演示数据库与程序绘制的原创山海插画；不包含生产知识库内容。
- `weixin-entry.jpg`：项目用户提供的微信入口截图，聊天消息摘要已在原图中打码，按原样保留。仅展示入口，不作为所有微信账号均可使用该通道的保证。
- `weixin-daily-settings.png`：0.9.31 独立演示库的微信收件设置；使用受控测试连接。
- `clipper-popup.png`：现有浏览器扩展面板截图，保留用于扩展介绍。
- `library.png`、`mobile.png`、`glass.png`、`cyber.png`：保留的早期展示截图；新版首页使用 `showcase-` 系列。

更新展示图时，请使用演示数据，避免发布 API 令牌、二维码、连接凭据或私人资料。界面截图保持真实，不修改按钮、功能状态或页面内容来模拟尚未实现的能力。

## 多端采集截图（2026-11-03）

- capture-android-quick/save：2026-10-30 隔离模拟器的实际 Android 原生面板，来自已目视检查的 android-glitch-local 验收；不是手机网页或真实荣耀手机截图，示例链接不代表采集结果。
- capture-mobile-remote：tests/cloudflare-inbox-ui.mjs --docs，当前 Worker 页面，zh-CN/Asia-Shanghai、390px触屏，隔离D1和实际本地API完成采集、失败与重试。
- capture-browser-tools/saved：tests/capture-showcase-ui.mjs，实际加载的 Edge 扩展和隔离本地服务；原创演示网页/配图，真实提交并核对两张图片入库。未包含个人令牌、二维码或私人素材。
