# 扩展的设计与参考

扩展采用石墨灰背景、分层面板和蓝紫色主操作。菜单、悬停大图、资源浮窗、作品页、连接设置与 Pixiv 入库页保持一致；网页知识库的主题独立设置。

## 从成熟项目中采用什么

| 参考实现 | ZNote 中的应用 |
| --- | --- |
| [Powerful Pixiv Downloader](https://github.com/xuejianxianzun/PixivBatchDownloader) 的抓取、筛选与下载状态分离 | 保留原功能，在最终结果上增加独立入库任务；下载成功和入库成功分别显示 |
| 同项目的停止、重试与结果持久化流程 | 入库页标记每个文件的结果，固定目标库，重试时跳过成功项；Pixiv 入库任务支持重启后继续 |
| 本项目现有 Readability / Turndown 正文提取流程 | 保持结构化 Markdown、链接和本地配图；连接与正文预览使用同一套表单样式 |
| [React 官方异步 Effect 清理示例](https://react.dev/reference/react/useEffect#fetching-data-with-effects) | 切换知识库取消旧列表请求；图库和深链接响应检查是否仍属于当前操作，防止旧库内容重新弹出 |

Pixiv 原项目按 GPL-3.0-or-later 使用，固定提交、署名、许可证和完整对应源码随增强版提供；ZNote 的新增 UI 与入库模块保持独立，不修改原下载器业务模块。

## 回归入口

构建网页后，通过真实 Edge 扩展与隔离知识库验证：

```bash
npm run build
npm test
node tests/library-switch-ui.mjs
node tests/knowledge-v083-ui.mjs
node tests/extension-design-ui.mjs
node tests/clipper-v08-ui.mjs
node tests/gallery-save-ui.mjs
npm run pixiv:build
node tests/pixiv-enhanced-ui.mjs
```

切换测试覆盖重复进入当前库、各分类、带搜索切库、延迟图库返回、笔记图片实际解码与失败后就地重试。界面测试覆盖浅色系统下的暗色扩展、手机宽度、快捷键、批量入库、失败重试、连接保留，以及 Pixiv 原下载和新增入库流程。

普通作品批量入库的临时任务仍按浏览器会话保存；增强版 Pixiv 任务使用 IndexedDB，两者的存续时间并不相同。
