# 在电脑和手机上使用 ZNote

ZNote 的图片、笔记和数据库保存在运行服务的电脑或 NAS 上。客户端连接同一地址，看到同一份内容；手机无需重复导入素材。当前客户端版本为 **0.10.0-beta.1**，属于公开测试版。

→ [下载 Release](https://github.com/BorderArea01/ZNote/releases) · [报告问题](https://github.com/BorderArea01/ZNote/issues/new/choose) · [交流与建议](https://github.com/BorderArea01/ZNote/discussions)

## 选择入口

| 设备 | 使用方式 | 本机存储服务 |
| --- | --- | --- |
| Windows 10 / 11，64 位 | EXE 安装包，或 ZIP 解压后运行 ZNote.exe | 可选内置服务，或连接原服务 |
| Mac，Apple 芯片 | arm64 DMG / ZIP | 可选内置服务，或连接原服务 |
| Mac，Intel 芯片 | x64 DMG / ZIP | 可选内置服务，或连接原服务 |
| Android 10 及以上 | 签名 APK | 连接电脑 / NAS |
| iPhone / iPad | Safari 访问；可添加到主屏幕 | 连接电脑 / NAS |
| Linux / 其他设备 | 浏览器访问；服务端可按 README 自托管 | 可自托管服务 |

**iPhone 主屏幕入口是 Web 应用，不是原生 IPA / TestFlight。** 原生 iOS 分发需要 Apple 开发者账号及签名，这一版本不提供可安装 IPA。客户端不提供整库离线同步；手机和电脑的浏览器扩展也不是同一个安装包。

## Windows 和 Mac

1. 从 Release 选择对应芯片的安装包。Windows 运行 EXE；Mac 打开 DMG，将 ZNote 拖入 Applications。
2. 已有知识库：填写服务器根地址，例如 `http://192.168.1.10:3741`。连接后填写原来的访问密码。
3. 第一次使用：选择「打开本机知识库」，设置访问密码，再上传图片或创建笔记。内置 Node.js，无需额外安装运行环境。

已有 `http://127.0.0.1:3741` 服务时，客户端直接连接它，不会搬动原数据或另开进程写原库。原服务仍由原来的启动方式管理。要连接 NAS，直接填写 NAS 的地址。

### 数据在哪里

内置本机服务使用系统用户数据目录下的 `data`：

- Windows：`%APPDATA%/ZNote/data`
- macOS：`~/Library/Application Support/ZNote/data`

可从菜单 / 托盘「本机数据目录」打开实际位置。不要直接复制正在写入的 SQLite 数据库；使用设置中的完整备份 / 恢复迁移。更新或正常卸载客户端保留数据；手动删除用户数据目录会删除本机知识库。ZIP 版也使用用户数据目录，不是把资料写进 ZIP 的解压目录。

关闭窗口会留在托盘 / 菜单栏，方便继续微信收件。选择「退出 ZNote」会停止客户端自己启动的本机服务。若连接的是另一个已有服务，退出客户端不会停止它。系统休眠或关机时，本机服务也无法收件和供手机访问。

### 视频与浏览器采集

普通上传、图片管理、Markdown、API 与现有网页版共用同一个服务。首帧封面、部分平台视频解析和 HLS 合并需要视频组件：在启动页展开「本机视频采集组件」，点击安装后再启动本机库。程序会从上游下载指定版本的 FFmpeg / yt-dlp，验证 SHA-256，并保留来源与许可证；约 50–70 MB。已有服务器继续使用其原有视频组件。平台登录、资源有效期、加密 / DRM 等限制仍然存在。

浏览器悬停采集、视频嗅探，请在 **Edge / Chrome** 安装设置页提供的扩展。Electron 客户端不代替日常浏览器，也不把采集扩展偷偷装进系统浏览器。

### 签名状态

Windows / macOS 首个测试版尚未获得商业代码签名证书 / Apple 公证，系统可能提示未知发布者。请核对 GitHub 仓库、文件名和 Release 的 SHA256SUMS；不要关闭系统整体安全保护。macOS 若拦截，可按系统「隐私与安全性」中对该应用的具体提示处理。不同系统版本可能有额外限制，应在报告问题时注明系统和芯片。

## Android

### 手机分享采集（Android 0.10.0-beta.3）

在其他 App 或浏览器选择「分享 → 保存到 ZNote」，也可打开 ZNote 顶栏「采集」粘贴分享文字。首次先连接并登录知识库；之后分享页沿用登录状态，记住上次选择的目标知识库。

- **分享链接**：手机仅提交链接，服务器保存可解析的网页正文、配图或平台视频；正文转为 Markdown，配图保存到服务器并成组，作者名作为标签，来源链接可追溯。复制来的整段 App 分享文字也可直接粘贴。
- **直接分享文件**：接收原 App 提供的图片或视频流，直接上传，不要求先手动下载到相册。多张图片自动成组；单张保持单图。附带的来源链接进入备注和来源字段；只有文件、没有链接时，不猜测出处。各 App 是否愿意分享原文件由原 App 决定。
- **查看进度**：链接交给服务器后可以返回原 App；可在网页版「网络采集」查看记录和重试。服务重启会保留任务，标记中断并等待重试。文件上传则要等到明确显示保存完成后再关闭页面。
- **外出收集**：把分享链接作为文字发给微信 ClawBot，在设置的「微信收件箱」打开「采集消息里的链接」并保存。不需要同一 Wi-Fi，电脑必须保持开机并联网。

局域网方式要求手机可连接服务器；服务器的网络用于下载网页和资源。单张图片 25 MB、视频 500 MB、一次直接分享最多 20 个文件，正文最多 100 张配图。关闭或失败不代表保存成功，以任务的「已入库」和可打开的本地资源为准。

**平台实测范围**：系统分享与自建测试页已覆盖；小红书、抖音的解析适配并不保证所有公开链接都能获取资源。当前外部样例测试遭遇小红书验证/失效页、抖音下载接口登录限制，尚未完成这两个平台的真实资源入库验收。完整的手机分享链接（含平台附带参数）比仅复制作品编号更可靠。此版本不跨 App 读取私人登录状态，不是全手机资源嗅探器。

此 APK 的采集功能需要同步更新服务端到包含 `/api/captures` 的版本；旧服务器需先更新，再安装 APK。现有服务数据位置不变。

下载 Release 中的正式签名 APK，从系统允许的安装入口安装。后续版本使用相同签名，安装更新保留连接信息。首次发布不是应用商店发行。

打开后填写电脑 / NAS 的地址。支持系统文件选择器多选上传、图片 / 视频预览、系统下载以及 Markdown 文件保存；只申请网络权限，不读取整个相册或通讯录。系统文件选择器仅将你选择的内容交给应用。文件下载进度由系统下载通知显示。

`localhost` 永远指当前设备：手机不能填写电脑的 `localhost`。公网连接使用 HTTPS；明文 HTTP 仅接受本机 / 局域网地址。不要把访问密码或 API 令牌拼进地址。客户端记住服务器地址，访问会话由 WebView 管理；清除应用数据会清除这些设置。

## iPhone / iPad 与主屏幕入口

用 Safari 打开知识库，登录后选择「分享 → 添加到主屏幕」。图标、名称和独立窗口配置随服务端提供。完整 PWA 能力通常需要 HTTPS；局域网 HTTP 的主屏幕行为以 Safari 当前系统版本为准。

本项目只缓存公开的断线提示页，不把私人笔记、API 响应和原图写进 Service Worker 离线缓存。离线时不能编辑整库，恢复网络后重新打开即可。Android / 桌面浏览器也可使用浏览器自己的安装入口。

## 局域网与远程访问

- 同一 Wi-Fi / 局域网：用服务端设置中显示的地址；确保防火墙允许受信任网络访问 3741。
- 外出：使用自己配置的 VPN 或 HTTPS 反向代理，让手机能够访问服务端；只安装客户端不会自动开通公网连接。
- 个人微信收件：由服务端与微信接口通信，手机不必和服务器处于同一局域网；服务器要保持在线且账号有相应入口资格。

多个知识库是资料范围划分，不是多用户权限隔离。公网部署方式见 [部署说明](../README.md#快速开始)。

## 从源码构建

所有发布对应的源码以 Release 标签为准。不要以最新 main 代替某个安装包的具体来源。

```bash
npm ci
npm test
npm ci --prefix clients/desktop
node clients/desktop/node_modules/electron/install.js
npm run desktop:build
```

使用 Node.js 24，在目标 Windows / macOS 芯片上构建。输出位于 `clients/desktop/release/`；`runtime/BUILD.json` 记录 Node、平台和版本。桌面包包含单独的 Node 运行时及依赖，保留第三方许可。不要把你自己的 `data/` 或用户配置复制进运行时。

Linux 自托管使用发行版维护的 FFmpeg，例如 Debian / Ubuntu 先运行 `sudo apt install ffmpeg`，再运行 `npm run media:setup` 获取 yt-dlp。若安装到自定义位置，设置 `ZNOTE_FFMPEG` 为完整路径。Docker 镜像已配置系统 FFmpeg。

Android 使用 JDK 21、Android SDK 36、Gradle Wrapper 8.13：

```bash
cd clients/android
./gradlew assembleRelease lintRelease
```

未设置签名环境变量时生成 unsigned APK，**不能将它当成可安装发行版**。可用 `ZNOTE_ANDROID_KEYSTORE`、`ZNOTE_ANDROID_STORE_PASSWORD`、`ZNOTE_ANDROID_KEY_ALIAS`、`ZNOTE_ANDROID_KEY_PASSWORD` 签名；或用 Android SDK `apksigner` 对受控构建产物签名。不要提交密钥；请保留同一签名密钥并独立备份，保证未来可覆盖升级。

仓库的 `Build clients` 工作流分别在 Windows、Apple 芯片 Mac、Intel Mac 与 Linux Android 构建机运行。发布前检查测试和签名，把安装包、对应版本源码及 SHA-256 校验清单一起附上。构建成功不能代替所有设备的实机验收。

## 反馈与维护

遇到问题请使用 [Bug 模板](https://github.com/BorderArea01/ZNote/issues/new?template=bug_report.yml)，注明版本、系统、访问方式和复现步骤。截图前遮住个人素材、密码、令牌和收件信息。建议与使用交流放在 [Discussions](https://github.com/BorderArea01/ZNote/discussions)。

安全漏洞请按 [SECURITY.md](../SECURITY.md) 私下报告。贡献代码与构建步骤见 [CONTRIBUTING.md](../CONTRIBUTING.md)。这是个人维护项目，优先处理数据完整性、无法启动和无法入库等问题，不承诺固定响应时限。
