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

Windows 长期运行建议使用计划任务。先退出已有的 `npm start` 服务，再在项目目录执行一次：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install-windows-server.ps1
```

安装后立即启动 `ZNote-Server`，之后在当前 Windows 用户登录时自动启动。启动器和 Node 均不创建控制台窗口，关闭日常使用的终端不会关闭知识库。每分钟检查任务是否需要启动，意外退出后自动恢复；已有任务运行时会忽略新的启动请求，不会每分钟重启服务。运行不设时间上限，也不会因为切换到电池供电而被计划任务停止。电脑仍需保持开机、不休眠；注销 Windows 用户会停止任务，重新登录后再启动。

计划任务先启动 Windows 自带的 `conhost.exe --headless`，再由它运行 PowerShell 启动脚本，避免终端委托机制在 PowerShell 应用隐藏参数之前弹出 Windows Terminal。脚本在内存中加载 `scripts/WindowsServerLauncher.cs`，无需安装未签名的启动器 EXE，也无需关闭 Windows 安全保护。Node 使用 `CreateNoWindow` 且重定向全部标准输入输出。启动器监控 conhost 的退出，并使用独立的 Windows Job Object 管理进程树；停止任务后同时停止 Node，避免遗留旧服务。旧版直接运行 `node.exe` 或 `powershell.exe` 的任务需按下文先停止、卸载，再重新安装。

默认使用仓库下的 `data/` 和端口 `3741`；自定义位置可给安装脚本传入 `-DataDirectory 'D:\ZNoteData' -Port 3741`。输出与退出记录位于数据目录的 `logs/`，单份日志超过 5 MB 后轮换，上一份保留为 `.previous` 文件。目录内可能含运行信息，不要直接公开整个日志目录。

`launcher.log` 额外记录启动器与 Node 的进程编号、原始退出码（十进制与十六进制）和启动失败。即使 Node 被强制结束、来不及写自身退出日志，也能留下外部观察到的退出码。操作系统同时终止整个进程树时，仍需结合 `previous_run_missing_exit` 和计划任务状态判断，不能仅凭缺失日志断言具体原因。

无窗口宿主采用 Windows Console 的 [headless 模式](https://github.com/microsoft/terminal/blob/main/src/host/ConsoleArguments.cpp)，子进程使用 [CreateNoWindow](https://learn.microsoft.com/en-us/dotnet/api/system.diagnostics.processstartinfo.createnowindow)，进程联动停止使用 [Windows Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)。`conhost` 不保证将子进程退出码传给计划任务，因此即使任务结果显示成功，也应以 `launcher.log` 中的 `child_exit` 为准；每分钟触发器同样会恢复已经退出的任务。

维护或更新时通过计划任务控制服务，不要同时再运行 `npm start`：

```powershell
Disable-ScheduledTask -TaskName ZNote-Server
Stop-ScheduledTask -TaskName ZNote-Server
# 等待旧进程释放端口；自定义端口时替换 3741
$stopDeadline = (Get-Date).AddSeconds(15)
while (Get-NetTCPConnection -LocalPort 3741 -State Listen -ErrorAction SilentlyContinue) {
    if ((Get-Date) -gt $stopDeadline) { throw '旧进程仍在监听，请先检查进程归属' }
    Start-Sleep -Milliseconds 200
}
# 完成备份、更新与构建后再启动
Enable-ScheduledTask -TaskName ZNote-Server
Start-ScheduledTask -TaskName ZNote-Server
Get-ScheduledTask -TaskName ZNote-Server
```

维护时先禁用任务，避免每分钟的触发器再次启动它。卸载后台任务：先禁用并停止任务，再执行 `Unregister-ScheduledTask -TaskName ZNote-Server -Confirm:$false`，数据不会被删除。更换仓库路径或 Node.js 安装路径后，卸载并重新安装任务。

计划任务恢复与并发设置参照 [Microsoft Task Scheduler 文档](https://learn.microsoft.com/en-us/powershell/module/scheduledtasks/new-scheduledtasksettingsset)。

### 排查服务退出

后台启动器在数据目录的 `logs/` 保留这些证据：

| 文件 | 记录内容 |
| --- | --- |
| `lifecycle.log` | 启动时间、PID、父进程、版本、退出码、关闭信号、异常调用栈；重启时提示上次是否缺少退出记录 |
| `server.stdout.log` / `server.stderr.log` | 普通输出和错误输出；空错误日志表示尚未写入错误，不代表遗漏文件 |
| `run-state.json` | 每 30 秒更新最后活动时间、运行时长和内存占用；正常退出时写入退出状态 |
| `reports/report.*.json` | 程序异常及 Node.js 内存耗尽等致命错误的诊断报告；启动时清理旧报告，保留最近约 10 份 |

崩溃报告使用 [Node.js diagnostic report](https://nodejs.org/api/report.html)，排除环境变量及网络接口信息。报告仍含程序堆栈和本地路径，请按需提取相关错误，不要直接公开全部日志。

强制结束、断电等情况可能来不及执行退出处理；下次启动会记录上一进程最后状态，但不会臆测是谁终止了它。故障时间附近还应对照 Windows 的 System / Application 事件，以及 `Microsoft-Windows-TaskScheduler/Operational` 任务历史。任务历史需要提前启用，未启用时不能补查过去的记录；启用权限取决于系统管理策略。

复现诊断路径的隔离测试：`node --test tests/runtime-diagnostics.test.js`，覆盖普通退出、异常、强制结束后重启和低堆限制下的内存耗尽，不使用正式知识库。

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

1. 在网页导出迁移备份 ZIP，并将文件保存到项目目录之外的可靠位置。
2. 停止当前 ZNote 服务，保留 `data/` 和配置。
3. 拉取代码，运行 `npm ci`、`npm run build` 后重新启动。
4. 检查 `/api/health`，打开已有笔记与素材确认内容可读。

若版本包含数据库迁移，回滚应同时恢复升级前的代码和数据；不能仅回退代码而继续使用不兼容数据库。备份与迁移细节见 [存储文档](STORAGE.md)。

扩展独立更新：0.8 起固定 ID，覆盖原扩展目录后重新加载并刷新网页，保留连接与偏好。0.7 及更早版本首次升级需移除旧版、加载新版，再在已登录 ZNote 中一键连接。
