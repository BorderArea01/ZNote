# 采集的 DNS 故障恢复

网页、图片、视频和配乐下载共用应用内解析器；不修改 Windows 网卡 DNS、系统代理、Clash、路由或 EasyTier。

## 解析顺序

1. 使用 `dns.lookup()` 的系统解析，最多三次，每次最多 1.5 秒，失败间隔 300/900 毫秒。成功时不请求公共 DoH。
2. 系统持续出现 ENOTFOUND、EAI_AGAIN 或解析超时，查询腾讯 DNSPod：`https://doh.pub/dns-query`。
3. 腾讯不可用时，查询 Cloudflare：`https://cloudflare-dns.com/dns-query`，沿用现有代理；未配置代理时直连。

每家 DoH 共用 3.5 秒预算，A/AAAA 查询同时进行，支持仅有 IPv6 的资源。取消会立即终止请求，晚到的系统解析结果不会覆盖后续结果。完全失败返回 `CAPTURE_DNS_FAILED`，当前任务保留失败状态，队列继续处理后续任务。

腾讯的 HTTPS 主机是 `doh.pub`；连接启动地址为 `1.12.12.12 / 120.53.53.53`。Cloudflare 直连启动地址为 `1.1.1.1 / 1.0.0.1`。固定启动地址只用于连接 DoH 服务，TLS 仍校验原主机名，避免系统 DNS 故障时连备用服务自身都找不到。它们不是写入系统的新 DNS 配置。

## 数据与边界

- 公共解析仅接收目标域名和记录类型，不发送作品 URL、分享文字、Cookie、知识库令牌或文件。单标签及 `.local`、`.localhost`、`.lan`、`.internal`、`.home`、`.arpa`、`.onion` 名称不使用公共备用。
- 限制 HTTPS 响应为 64 KiB，不跟随重定向；核对问题域名、类型、响应码及 CNAME 链，只接受匹配的地址记录。下载器仍检查所有返回 IP 和每次资源跳转，不能通过备用 DNS 绕过内网限制。
- 只有备用成功结果进入应用内缓存，最多256个域名，期限取记录/CNAME TTL与60秒的较小值。系统解析仍优先；系统恢复后清除该域名的备用缓存。失败不长期缓存。
- 不重新提交采集任务或重放上传操作。已有失败任务通过原入口重试，保持原编号和已保存项的去重规则。平台403、登录验证及文件大小错误不触发 DNS 备用。

## 日志与验证

`data/logs/server.stderr.log` 中的 `[capture_dns]` 记录域名、解析器、错误码和耗时，不包含完整分享 URL 或认证信息。任务最终状态仍由 `/api/captures` 和 Cloudflare 队列持有。

定向回归包含 `tests/capture-dns.test.js` 和 `tests/capture-doh.test.js`。`tests/capture-doh-live.mjs --live` 只在自身解析器注入故障，验证真实腾讯/Cloudflare备用；可带 `--source-job=<本机失败任务ID>` 检查原作品解析，不修改系统 DNS 或任务状态。

`tests/capture-doh-recovery-live.mjs --live --source-job=<任务ID>` 会实际重试指定的已有云端任务，并保留入库内容。只能在用户已授权恢复这些任务时执行。它核对原任务/目标库、媒体哈希、Range、桌面和模拟触屏播放；仅删除自身临时授权，不清除用户任务或文件。

参考：[Node系统解析](https://nodejs.org/api/dns.html#dnspromiseslookuphostname-options)、[腾讯免费DoH](https://cloud.tencent.com/document/product/302/110786)、[Cloudflare DoH JSON接口](https://developers.cloudflare.com/1.1.1.1/encryption/dns-over-https/make-api-requests/dns-json/)。JSON格式由各服务提供，解析器对结构进行严格检查，不执行响应中的代码。
