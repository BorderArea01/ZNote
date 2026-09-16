# ZNote 扩展目录

[返回首页](../README.md)

所有公开、可选的向外扩展都从这里进入。按运行位置分三类，避免浏览器扩展、外部服务连接器和 AI 插件混在一起。

| 分类 | 目录 | 内容 | 是否随 ZNote 服务启动 |
| --- | --- | --- | --- |
| 浏览器 | [`browser/`](browser/) | Chrome / Edge 网页采集扩展 | 否，浏览器单独加载 |
| 连接器 | [`connectors/`](connectors/) | 微信等外部服务接入说明与适配 | 按设置启用 |
| AI 工作流 | [`ai/`](ai/) | Codex Skill 等可选 AI 插件 | 否，按需安装 |

当前公开组件：

- [浏览器采集扩展](browser/clipper/README.md)
- [微信收件连接器](connectors/weixin/README.md)
- [AI 对话学习笔记](ai/znote-conversation-notes/skills/znote-conversation-notes/SKILL.md)

专用或私人插件在独立私有项目维护，不把源码、构建缓存或下载地址放进本仓库。新增公开扩展时，应放入对应分类，并同时更新本页、[文档索引](../docs/README.md)和根 README。

本机需要集中维护私人浏览器扩展时，统一放在 `addons/browser/private/`。公开仓库会忽略这个目录的全部内容，包括嵌套仓库、源码、构建产物和安装包。
