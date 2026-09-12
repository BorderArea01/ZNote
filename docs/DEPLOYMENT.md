# 部署与升级

[返回首页](../README.md)

## 本机运行

需要 Node.js 24+。在项目目录运行：

```bash
npm ci
npm run build
npm start
```

浏览器打开 `http://localhost:3741`，设置至少 4 个字符的访问密码，支持四位数字。首次初始化默认仅允许从服务器本机进行；日常登录支持局域网。

Windows 需要后台运行时，可在项目目录执行：

```powershell
Start-Process -FilePath (Get-Command node).Source -ArgumentList 'server/index.js' -WorkingDirectory (Get-Location).Path -WindowStyle Hidden -RedirectStandardOutput (Join-Path (Get-Location) 'server.log') -RedirectStandardError (Join-Path (Get-Location) 'server-error.log')
```

## 局域网访问

服务默认监听 `0.0.0.0:3741`。在设置中找到服务器实际局域网 IP，其他设备访问 `http://该IP:3741`。列表可能包含虚拟网卡，请选择实际连接局域网的地址；检查防火墙端口和路由器客户端隔离。服务器需保持运行。

## Docker / NAS

```bash
docker compose up -d --build
```

首次初始化前，在 `.env` 中加入 `ALLOW_REMOTE_SETUP=true`。访问 `http://NAS_IP:3741` 设置密码后，删除该变量并再次运行 `docker compose up -d`。

Compose 使用 `znote-data` 持久卷，镜像以非 root 用户运行并提供健康检查。容器包含 FFmpeg 和固定版本 yt-dlp。不要删除持久卷；`docker compose down -v` 会删除数据卷。

Docker 配置已提供，尚未完成容器运行验收。

## 配置

| 环境变量 | 默认值 | 用途 |
| --- | --- | --- |
| `HOST` | `0.0.0.0` | 监听地址 |
| `PORT` | `3741` | Node 服务端口 |
| `DATA_DIR` | `./data` | 数据目录 |
| `ALLOW_REMOTE_SETUP` | `false` | 允许远程执行首次初始化 |
| `COOKIE_SECURE` | `false` | HTTPS 部署时设置为 `true` |
| `ZNOTE_YTDLP` | 自动查找 | yt-dlp 可执行文件路径 |
| `ZNOTE_FFMPEG` | 自动查找 | FFmpeg 可执行文件路径 |

直接运行 Node 时，在启动进程的环境中设置变量；服务不会自动读取 `.env`。Compose 的 `.env` 用于其配置替换，当前模板传入初始化和 Cookie 选项。修改 Compose 的端口还需同步调整端口映射。

通过互联网访问时使用 HTTPS 和适当的访问控制；反向代理保留 Host，并为大文件上传设置足够的请求体与超时限制。

## 可选媒体组件

```bash
npm run media:setup
```

脚本下载并校验官方 yt-dlp，检查 FFmpeg。平台视频解析使用 yt-dlp；HLS 分片合并使用 FFmpeg。组件下载到 `tools/media/` 或 optional dependency 中，不随 Git 仓库提交。也可以使用系统安装的组件并设置上表中的路径。

源站的登录、防盗链、过期链接和网络条件可能影响采集；普通图片、笔记及已有视频文件管理不依赖平台解析器。

## 更新与回滚

1. 在网页生成完整备份，并将备份复制到项目目录之外的可靠位置。
2. 停止当前 ZNote 服务，保留 `data/` 和配置。
3. 拉取代码，运行 `npm ci`、`npm run build` 后重新启动。
4. 检查 `/api/health`，打开已有笔记与素材确认内容可读。

若版本包含数据库迁移，回滚应同时恢复升级前的代码和数据；不能仅回退代码而继续使用不兼容数据库。备份与迁移细节见 [存储文档](STORAGE.md)。

扩展独立更新：0.8 起固定 ID，覆盖原扩展目录后重新加载并刷新网页，保留连接与偏好。0.7 及更早版本首次升级需移除旧版、加载新版，再在已登录 ZNote 中一键连接。
