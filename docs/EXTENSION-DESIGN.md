# 扩展的设计与参考

扩展入口按采集、任务、插件分区。新弹窗与插件管理页面采用深色绿色面板、手写 Z 图标；悬停预览与媒体处理页面保留现有布局，网页知识库的主题独立设置。导航、问号帮助和基础样式从 `addons/browser/common/` 复用，维护协议见 [浏览器插件维护](BROWSER-ADDONS.md)。

## 从成熟项目中采用什么

| 参考实现 | ZNote 中的应用 |
| --- | --- |
| 本项目现有 Readability / Turndown 正文提取流程 | 保持结构化 Markdown、链接和本地配图；连接与正文预览使用同一套表单样式 |
| [React 官方异步 Effect 清理示例](https://react.dev/reference/react/useEffect#fetching-data-with-effects) | 切换知识库取消旧列表请求；图库和深链接响应检查是否仍属于当前操作，防止旧库内容重新弹出 |

专用插件在独立项目维护，公开知识库只保留通用 API 接入能力。

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
```

切换测试覆盖重复进入当前库、各分类、带搜索切库、延迟图库返回、笔记图片实际解码与失败后就地重试。界面测试覆盖浅色系统下的暗色扩展、手机宽度、快捷键、批量入库、失败重试、连接保留。

普通作品批量入库的临时任务按浏览器会话保存；其他插件的任务存续和恢复规则由插件自身说明。
