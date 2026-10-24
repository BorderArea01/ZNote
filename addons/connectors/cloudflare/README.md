# ZNote · Cloudflare 远程采集收件箱

可选连接器：手机与开发机分别联网，手机浮窗提交分享链接，开发机主动取回并调用现有采集队列。无需域名、公网 IP、路由器端口映射或入站隧道。

```text
Android 浮窗 / 分享 / 远程采集页
            ↓ HTTPS
Cloudflare Workers 或 Pages + D1：链接、知识库目录、任务状态
            ↑ 开发机每 10 秒主动同步
本机 ZNote /api/captures → 下载资源 → 本机知识库
```

云端不接收图片或视频文件，也不转发任意本地 HTTP 请求，不提供原图库和媒体下载。手机切换到远程地址后，App 首页是收件任务页；在局域网内浏览完整图库仍使用原服务器地址。平台解析继续由原服务负责：跨网络不解决平台登录、验证、失效作品或尚未适配站点的问题。

Android beta.23 起，已经保存并授权的局域网连接可用时自动直连，不经过本收件箱；局域网不可达或授权不可用时，新链接才使用远程入口。原始任务始终保留提交时的入口，切网不跨队列重复投递。仅使用远程邀请、从未连接本机的设备，需要先在 App 连接并登录局域网地址一次。后台连接器的轮询周期保持不变。

## 手机连接

1. 在 ZNote App 的服务器地址中填写部署后的 HTTPS 根地址，例如 `https://your-inbox.pages.dev`。
2. 输入开发机生成的一次性设备连接码。它独立于原知识库 PIN，24 小时内有效且只能使用一次；连接成功后设备授权可持续使用，不需要每次输入。
3. 之后继续使用现有浮窗、分享、粘贴入口，选择目标知识库后提交链接。现有安卓客户端的健康检查、Cookie 登录、设备令牌、知识库目录、提交、进度和重试接口保持兼容，不需要为这项连接器改 APK。

开发机离线时任务保留在云端。在线连接器默认约十秒开始处理；下载耗时和平台验证仍以实际任务状态为准。“链接已接收”表示排队，不表示资源已入库。开发机需开机、联网，ZNote 与收件任务均需运行。手机自身也必须能访问所选免费域名，运营商直连不可达时需要可用网络或代理，不能把发布成功当成手机连通成功。

## 免费范围与存储

- 仅使用 Workers / Pages Functions 与 D1 的 Free 可用能力，不开通付费订阅、R2 或视频转存。当前官方额度：Workers 100,000 请求/日，D1 5,000,000 行读取/日、100,000 行写入/日、总存储 5 GB；两个入口共享配额，不是各有一份。开发机空闲轮询约 8,640 请求/日，手机查询另计。
- 每次请求体最多 32 KiB，分享文字最多 16,000 字符；云端待处理和失败记录合计最多 200。成功记录保留七天，过期清理每小时执行；不会自动删除待处理/失败任务，也不会删除本机资源。完成或失败的云端记录可通过 `DELETE /api/captures/:id` 清理。
- 一份收件箱对应一个私人 ZNote 实例，所有已配对设备共享其目录和任务；不提供多租户权限隔离。云端保存经过授权投递的链接/正文及目录名称，不保存原图、视频、原知识库 PIN 或本机 API 凭据。

官方资料：[workers.dev](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/)、[Workers 限制](https://developers.cloudflare.com/workers/platform/limits/)、[D1 免费额度](https://developers.cloudflare.com/d1/platform/pricing/)。

## 维护与部署

源码集中于本目录：`worker.js` 为受限收件 API，`schema.sql` 为 D1 表，`portal.js` 为手机连接及任务页，`collector.js` 为本机收件协议。管理工具 Wrangler 独立安装在本目录，不改变根项目的 Vite 或依赖配置。

```powershell
npm ci --prefix addons/connectors/cloudflare --ignore-scripts
# 使用 Cloudflare 官方 Wrangler 登录自己的账号；已有有效授权可复用
node addons/connectors/cloudflare/node_modules/wrangler/bin/wrangler.js login
# 创建新 D1 后，把其编号和自己的账号编号交给本机配置工具
node addons/connectors/cloudflare/setup.mjs init ACCOUNT_ID DATABASE_ID
```

`init` 仅用于首次配置，已有配置时拒绝覆盖。它生成单独的本机写入令牌和云端连接器密钥，保存在被 Git 忽略的 `data/cloudflare-collector/config.json`；本机令牌不会上传 Cloudflare。实际账号编号、D1 编号、部署配置和连接码同样只留在 `data/`，不要提交或粘贴整个配置文件。

使用 `data/cloudflare-collector/wrangler.json` 显式配置执行：

1. `wrangler d1 execute znote-capture-inbox --remote --file <schema.sql绝对路径> --yes --config <wrangler.json绝对路径>`。
2. `wrangler deploy --config <wrangler.json绝对路径>`。先确认同名 Worker 不属于其他项目，不能覆盖已有应用。
3. `node addons/connectors/cloudflare/setup.mjs secret`，通过标准输入配置独立的 `CONNECTOR_SECRET`。
4. `node addons/connectors/cloudflare/setup.mjs set-url https://你的固定地址`，实际验证健康接口后保存地址。
5. `node addons/connectors/cloudflare/setup.mjs pair`。连接邀请 `import_url` 和兼容旧版的连接码写到 `data/cloudflare-collector/pairing.json`，不输出到常规日志；临近手机连接时再生成。邀请有效 24 小时、仅可用一次，持有者可以授权设备，不要公开分享。

### 一键导入手机

Android beta.21 起，手机打开 `import_url`，点「导入 ZNote App → 确认连接」即可自动配置地址与浮窗授权，不需要手动抄写两个字段。网页使用 Android 的显式包名 Intent 唤起 App；浏览器拦截唤起时点「复制备用配置」，再在 App 连接页「导入连接邀请」粘贴。旧版本先在应用内覆盖更新。原局域网连接保留，可从连接页「使用上次连接」切回。

邀请使用完整的 `/connect/<一次性码>` 地址，刷新、复制地址或重新打开都保留连接信息；旧 fragment 链接打开后自动升级为完整地址。授权码会随邀请页请求送往自己的云端，页面禁止缓存和 Referer，不加载第三方脚本；不要公开分享或在常规日志记录邀请。只在用户明确操作后兑换，预览和刷新不消耗授权。缺少邀请时页面可粘贴完整链接恢复，不再要求用户到开发机处理。App 显示目标地址并由用户确认，验证健康接口，再兑换独立设备令牌；不跟随重定向，不保存一次性码。失败/取消不会替换原配置；设备令牌失败可用同一会话重试。

### 可选 Pages 地址

与 Worker 使用同一 D1 和同一受限队列。`node addons/connectors/cloudflare/build-pages.mjs` 生成独立 `_worker.js` 和页面，再配置 Pages 项目的生产 `DB` 绑定与密钥。使用 `setup.mjs secret-pages` 和 `deploy-pages.mjs`，它们保持部署工作目录独立。

可选代发公开的已签名 Android 发布包：在被忽略的 `data/cloudflare-collector/client-release.json` 设置 `version`、`apk`、`source`（仅限 `artifacts/` 内对应 APK / 源码 ZIP）及两者的 `apk_sha256`、`source_sha256`。构建时验证摘要和每文件 24 MiB 预算，只复制这两个明确指定的公开产物，生成 `/downloads/latest.json`；该静态目录不进入收件鉴权。邀请页自动提供同源下载，适用于 GitHub 匿名访问不可达的情况。它不会替换旧 App 内的 GitHub 更新协议；首次可直接覆盖安装。禁止把数据目录、令牌或用户素材作为发布包。

Wrangler 4.151.3 的新 Pages 命令可能自动委托 Workers，并试图迁移当前项目的 Vite/依赖。首次明确选择旧 Pages 时，使用官方命令的 `pages project create ... --force` 选择 Pages；已有 Pages 项目不要反复传 `--force`。不得在根项目盲目重试框架自动迁移。Pages 不接受任意配置文件路径；部署工具会生成自己的标准 `wrangler.json`，通过环境指定账号，避免上级配置覆盖或不支持的 `account_id` 字段。

### Windows 后台运行

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install-cloudflare-collector.ps1
Get-ScheduledTask -TaskName ZNote-Cloudflare-Collector
```

沿用现有无窗口宿主和 Windows Job Object，只管理本连接器的进程树。登录 Windows 后启动，意外退出后每分钟尝试恢复，不同时启动第二个连接器。Node 堆上限 128 MiB。日志位于 `data/cloudflare-collector/logs/`，只记录连接状态/错误类别，不记录分享内容与凭据；本机 ZNote 服务独立维护，不随连接器启停。

更新时先确认 `state.json` 无在途任务，禁用并停止 `ZNote-Cloudflare-Collector`，等待原 Node 进程实际退出后再启用/启动；不能只等待固定 500ms。服务端采集的确定性 `cf:<云端任务编号>` 防止响应丢失后重复入库，状态文件保留领取凭证和本机任务编号，云端失败只有用户明确重试后才触发本机重试。

卸载时只删除自己的计划任务，在 ZNote 令牌设置撤销“Cloudflare 远程链接收件”，并按需要删除本次创建的 Cloudflare 收件应用/数据库；不要删原知识库或其他云应用。

## 验证

```powershell
node --test --test-concurrency=1 tests/cloudflare-inbox.test.js tests/cloudflare-collector.test.js
node tests/cloudflare-inbox-ui.mjs
# 显式真实云端/当前本机实例验收，创建后清理自己的临时库与授权
node tests/cloudflare-inbox-live.mjs --live
```

本地 D1 适配器测试不等于 Cloudflare 已部署，模拟触屏不等于 Android 真机。部署验收还需核对实际 D1、HTTPS 入口、后台进程、真实本机文件及手机网络；不得用某个公开视频成功代替所有平台登录内容的兼容性。
