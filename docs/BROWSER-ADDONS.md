# 浏览器插件维护

[文档索引](README.md) · [浏览器插件目录](../addons/browser/README.md)

## 使用入口

网页采集弹窗分为「采集、任务、插件」。目标知识库始终位于顶部，修改后保存到浏览器本地；当前任务沿用提交时的目标。采集页保留当前作品、媒体嗅探、正文和两种截图，粘贴链接与平台视频解析收进可展开区域。任务页显示作品、视频、截图和本页后台媒体结果，并保留取消与重试。

X 作品详情页右侧固定显示「ZNote · 保存本帖」，不依赖网站是否渲染时间或操作栏；时间线的含图推文在操作栏显示「保存图组」。按钮对应当前作品，平台解析不采集引用推文图片。SPA 换帖更新链接，黑名单立即隐藏入口。

插件页提供当前扩展版本、图片预览和媒体浮窗开关，以及浏览器扩展管理入口。不会增加读取其他扩展的权限，不能把未知的安装状态显示为“已安装”。其他插件的版本、启停和重新加载由浏览器管理。

## 目录与协议

公开清单位于 `addons/browser/catalog.json`，其中只列公开插件的 `addon.json`。本机其他插件使用被忽略的 `addons/browser/private/catalog.json`；各自源码、依赖、产物、登记信息和安装包保持私有。

每个 `addon.json` 使用 `schemaVersion: 1`，包含：

| 字段 | 含义 |
| --- | --- |
| `id` / `name` | 稳定的管理编号 / 显示名称 |
| `visibility` | `public` 或 `private`，必须与所属清单一致 |
| `extension` | 相对插件目录的浏览器加载目录，不得越界 |
| `expectedId` | 固定公钥对应的浏览器扩展 ID；不匹配时停止构建覆盖 |
| `capabilities` | 能力清单，例如 image、gallery、video、article、screenshot |
| `build.cwd` / `build.script` | 构建所在目录及 package.json 中的脚本名，执行时不经过 shell 拼接 |
| `assets` | 除 manifest 引用资源以外，必须存在的运行资源 |

`common/` 是导航、帮助和基础样式的权威来源。普通扩展构建复制至 `clipper/ui/`；其他插件构建复制到自己的加载目录，并随对应源码包携带副本。插件自行持有连接与任务，不能跨插件复制令牌或清空既有存储。

## 常用命令

在仓库根目录执行：

```sh
npm run addons -- list
npm run addons -- check
npm run addons -- check clipper
npm run addons -- build clipper
npm run addons -- pack clipper
```

`list` 展示状态，`check` 在检查失败时以非零状态退出。`build` 只更新加载目录；其他插件通过 `--no-pack` 跳过生成安装包。`pack` 才生成安装包，私人插件继续使用各自构建器同时提供许可证要求的对应源码。公开扩展包保存在被忽略的 `artifacts/browser-addons/`。`list` 和 `check` 需要机器读取时加 `--json`；构建仍输出构建器日志。

新增插件：先创建自身目录、固定公钥和构建脚本，再填写 `addon.json`，登记到对应清单，执行检查、构建、隔离 UI 验证。不要修改已有插件公钥来“解决”版本或安装问题。检查工具不访问浏览器凭据，也不会启动、卸载或自动升级插件。

## 验证与更新

```sh
npm run clipper:build
node --test tests/browser-addons.test.js
node tests/clipper-entry-ui.mjs
node tests/post-capture-ui.mjs
node tests/clipper-region-ui.mjs
```

覆盖鼠标、触屏、键盘页签、知识库记忆、帮助开关、失败重试、任务结果、下一次采集，以及 X 详情页没有时间标签和操作栏的情况。检查当前实例与安装目录后覆盖原目录、保持公钥和存储不变；现有网页需在重新加载扩展后刷新。

导航参考 [Chrome 弹窗生命周期](https://developer.chrome.com/docs/extensions/develop/ui/add-popup)，后台任务不能依赖弹窗常驻。右键菜单按 [contextMenus 官方接口](https://developer.chrome.com/docs/extensions/reference/api/contextMenus) 组织为一个根入口，截图与视频分别收进子菜单。
