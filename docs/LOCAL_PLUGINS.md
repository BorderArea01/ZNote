# 本地创作插件

知识库内插件集中安装在仓库根目录的 `plugins/<插件标识>/`。整个 `plugins/` 已加入 Git ignore；插件源码、构建文件和测试不进入公开仓库。通用宿主在 `server/local-plugins.js`、`src/LocalPlugins.jsx`，不包含私人插件实现。

入口位于左栏内容分类下方、标签筛选之前。在「创作插件」旁点击管理按钮，重新扫描并启用即可使用，无需重启服务或重新构建 ZNote。停用会撤下入口并卸载正在打开的页面；移走插件文件夹后重新扫描也会卸载。重新放回相同标识可继续读取原数据。关闭页面会销毁 iframe 与其中的事件、定时器，避免后台常驻。

## 安装协议 v1

插件只提供静态网页，不执行服务端脚本、安装命令或 npm 生命周期。

```json
{
  "id": "example-tool",
  "name": "示例工具",
  "version": "1.0.0",
  "description": "插件用途。",
  "api": 1,
  "entry": "index.html",
  "files": ["index.html", "main.js", "style.css"]
}
```

`manifest.json` 与所有白名单文件置于同一目录。标识必须与目录名相同，只允许小写英文、数字和连字符，且以字母开头。所有文件必须为本目录内的普通文件；路径穿越和越界符号链接会被拒绝。不提供浏览器远程安装或执行任意构建命令的接口。

插件页面在 ZNote 同源 iframe 内运行，属于可信本地代码，具有当前知识库会话的权限；这不是不可信代码沙箱。只安装自己信任的插件。页面内容安全策略禁止外部脚本与外部网络连接。管理启停和扫描需要管理员权限；资料写入遵守原有读写令牌权限，不改变 PIN 或登录机制。

## 资料与素材

- `GET /api/plugins`：插件目录、启停状态、清单错误。
- `POST /api/plugins/rescan`：重新扫描文件夹。
- `PATCH /api/plugins/:id`：`{"enabled":true}` 启停。
- `GET /api/plugins/:id/state`：读取 `{version,data,updated_at}`。
- `PATCH /api/plugins/:id/state`：传入旧 `version` 与新 `data`；版本冲突返回 409，不覆盖别人的修改。资料最高 1.5 MB，仅存文字和引用，不内嵌媒体。
- `POST /api/plugins/:id/resolve`：批量解析素材引用，最多 200 条，返回可用状态与当前封面。单项引用 `{type:"item",id}`；整组引用 `{type:"group",kind,collection_id,group_key}`；附件引用 `{type:"file",id}`。原件删除或分组变化会反映在解析结果中，不创建隐式副本。
- `GET /api/plugins/:id/files`：插件现有附件；`POST` multipart `file` 上传新附件，单个最高 200 MB，磁盘流式暂存。`GET /api/plugins/:id/files/:file` 下载附件，强制下载，不执行 HTML 等附件内容。

宿主选择器：插件向父窗口发送 `{type:"znote:plugin",action:"pick-resources",requestId}`。父窗口返回 `{type:"znote:host",requestId,result:[{ref,title}]}`；取消返回空数组。必须校验消息的 `source` 和 `origin`。`action:"open-item",id` 用原有知识库预览打开素材，支持图片、图组、视频组和笔记。`action:"close"` 关闭工作台。

插件状态、附件索引和启停设置存入现有 SQLite 的 `settings`，分别使用 `plugin.state:`、`plugin.files:`、`plugin.enabled:` 前缀。附件只在 `data/media` 保存一次；多个角色共享同一个附件 ID。插件本身不修改原素材表，不移动、不拆组、不重新导入。停用、移走源码、删除角色或解除引用都不删除原素材和附件。

## 备份与迁移

完整迁移 ZIP 和恢复快照都包括插件资料、附件索引和附件原文件；恢复时重新映射附件存储路径并校验 SHA-256。恢复快照沿用已有硬链接策略，不复制整套原图。插件源码不进入内容备份，迁移时另行复制 `plugins/` 文件夹。

仅导出角色设定 JSON 属于文字与引用清单，不能替代包含附件的完整备份。不要将私人插件或真实角色资料提交进公共仓库。

宿主生命周期参考 [VS Code Webview](https://code.visualstudio.com/api/extension-guides/webview) 与 [Obsidian 插件资源清理](https://docs.obsidian.md/plugins/guides/lifecycle-management)：关闭或停用时卸载页面，资料独立持久化，不为隐藏页面保留常驻运行环境。

## 界面约定

插件使用中性灰阶或继承宿主主题，避免大面积固定绿色等强烈默认配色；用户主动选择的阵营标记色可保留。帮助说明沿用宿主 HelpHint，兼顾鼠标、键盘和触屏；素材选择、关闭与错误恢复应在手机宽度下保持可用。
