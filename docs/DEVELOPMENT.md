# 开发与维护

[返回首页](../README.md)

## 项目结构

```text
src/                    React 页面、主题和交互
server/                 Express API、SQLite、媒体、备份和 Webhook
shared/                 前后端共用的来源处理
extensions/clipper/     Chrome / Edge Manifest V3 扩展
examples/               外部采集、事件轮询和 Webhook 接收器
scripts/                构建、媒体组件安装与维护脚本
tests/                  API 和浏览器测试，使用独立临时数据
docs/                   部署、存储、API 和示例截图
```

`data/`、`node_modules/`、`dist/`、`artifacts/`、运行日志及下载的媒体工具不进入版本控制。不要提交访问令牌、Cookie、备份或自己的素材库。

## 本地开发

```bash
npm ci
npm run build
npm start
```

另开终端执行 `npm run dev`，Vite 开发服务通过配置代理访问后端。API 修改后重启后端。

## 扩展开发

直接在 Chrome / Edge 开发者模式加载 `extensions/clipper/`。保持 manifest 中的固定 `key` 不变，避免改变 ID 和丢失连接设置。

修改 `article-source.js`、`work-images.js` 或站点适配器后运行：

```bash
npm run clipper:build
```

此命令生成离线正文提取脚本并复制对应许可证。其他扩展源码可直接重新加载。刷新目标网页使新的 content script 生效。

测试使用隔离浏览器配置，不修改日常使用的扩展设置。

`node tests/gallery-ui.mjs` 验证悬停滚轮、页序原文件、失败重试、停止继续和刷新恢复；`node tests/work-images-ui.mjs` 验证 Pixiv / Pawchive 作品分组。下载文件保存在各测试自己的 `artifacts/` 子目录。

`node tests/hover-wheel-ui.mjs` 保持鼠标在原缩略图上验证滚轮翻页，并覆盖展开预览中央、慢速连续翻页、当前页下载及外部区域滚动。交互调查参考了 [Powerful Pixiv Downloader 的 PreviewWork](https://github.com/xuejianxianzun/PixivBatchDownloader/blob/master/src/ts/PreviewWork.ts)，本项目独立实现事件范围判断与异步翻页，不包含该项目源码。

`node tests/cover-groups-ui.mjs` 验证 48px 的 Pixiv 列表封面、Paw 遮罩封面与作品来源；`node tests/preview-speed-ui.mjs` 对比轻量预览与延迟原图，验证预加载、翻页耗时、原文件下载和手动原图预览。缓存的请求合并与释放另由 `preview-cache.test.js` 覆盖。

## 验证

```bash
npm test
npm run build
npm run test:ui
npm run test:features
```

API 测试使用 Node 内置测试器和独立 SQLite 数据库；部分视频/HLS 测试需要 FFmpeg。浏览器测试默认使用 Playwright 的 Microsoft Edge channel，需安装 Edge。

扩展与主题测试：

```powershell
$env:UI_DIST = 'dist'
node tests/media-tools-ui.mjs
node tests/clipper-ui.mjs
node tests/clipper-v08-ui.mjs
node tests/themes-ui.mjs
node tests/knowledge-v083-ui.mjs
node tests/site-articles-ui.mjs
node tests/gallery-save-ui.mjs
npm run pixiv:build
node tests/pixiv-enhanced-ui.mjs
```

`tests/clipper-v08-ui.mjs` 验证一键连接、升级保留设置、预览避让和正文归档。其他历史浏览器脚本的默认构建目录见文件顶部；支持 `UI_DIST` 的脚本可统一指定 `dist`。

`tests/gallery-save-ui.mjs` 使用受控 Pixiv 页面与独立真实 API 数据库，验证整组入库的原图字节、标签/来源/页码、知识库隔离、停止与刷新恢复，以及响应丢失后的去重重试。任务临时进度遵循 [Chrome storage.session 生命周期](https://developer.chrome.com/docs/extensions/reference/api/storage#property-session)。

`tests/pixiv-enhanced-ui.mjs` 加载完整增强版，调用上游真实抓取 / 导入结果流程，再验证 ZNote 入库、浏览器重启恢复、APNG 每帧像素与时序、小说本地配图和原插件下载。浏览器原生的可选主机权限弹窗不属于页面自动化范围，测试副本仅预授予独立回环 API 主机，发布版仍由用户点击连接时授权。

测试数据和截图保存在 `artifacts/`。真实网站还会受到账号状态、地区、网络和站点改动影响；受控页面通过不代表所有平台链接均可采集。

## 提交改动

- 描述用户遇到的问题、修改后的行为与验证方式。
- 数据或存储改动保留兼容与回滚路径。
- 修改扩展时验证重新加载后配置保留，以及原有鼠标/快捷键交互。
- 只发布测试生成的示例截图，不使用私人知识库或他人账号信息。
- 修改功能后同步 README、对应文档和更新记录。

主要功能包括图片/视频/Markdown、标签检索、数据恢复、来源追溯、浏览器采集和 Webhook。新增能力优先复用现有 API 与持久化路径。
