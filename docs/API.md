# API 与插件接入

[返回首页](../README.md)

运行服务后，登录打开 `/api-docs` 查看可交互接口；完整 OpenAPI 描述位于 `/api/openapi.json`。以运行版本的 OpenAPI 为准。

## 鉴权

在「设置与连接」创建 `read` 或 `write` 令牌，通过 `Authorization: Bearer …` 调用。原始令牌仅显示一次，可随时撤销。管理员会话使用 HttpOnly Cookie。

| 权限 | 范围 |
| --- | --- |
| `read` | 内容、媒体、知识库和变更事件读取 |
| `write` | 内容与知识库读写，上传和采集 |
| 管理员浏览器会话 | 令牌管理、完整备份、恢复、导出及 Webhook 管理 |

```bash
curl http://localhost:3741/api/items \
  -H "Authorization: Bearer YOUR_API_TOKEN"
```

媒体接口同样需要鉴权，不是公开图床。网页写入默认要求同源；被授权扩展使用 Bearer 令牌。

## 常用接口

| 接口 | 用途 |
| --- | --- |
| `GET/POST /api/items` | 查询、创建笔记 |
| `GET/PATCH/DELETE /api/items/:id` | 获取、更新、移入回收站 |
| `POST /api/items/:id/restore` | 恢复内容 |
| `POST /api/assets` | 上传一张图片，multipart `file` |
| `POST /api/assets/batch` | 批量上传，返回逐文件结果 |
| `POST /api/videos` | 上传视频原文件 |
| `GET /media/:id/original` | 原文件；视频支持 Range 请求 |
| `GET /media/:id/thumbnail` | 按需图片缩略图 |
| `GET/POST /api/collections` | 知识库查询与创建 |
| `GET /api/tags` | 标签及计数 |
| `POST /api/items/batch-tags` | 批量添加、移除或替换标签 |
| `POST /api/items/batch-organize` | 批量移动和收藏 |
| `POST /api/items/batch-trash` | 按知识库批量移入回收站或恢复 |
| `POST /api/items/:id/copy` | 跨库复用，共享原文件 |
| `GET /api/events?after=0` | 持久化增量事件 |
| `GET /api/export?mode=markdown` | 按模式导出，需要管理员会话 |
| `POST /api/imports` | 平台视频采集任务，返回 202 与任务 ID |
| `GET/DELETE /api/imports/:id` | 查询或取消任务 |
| `POST /api/streams` | 合并浏览器采集的 HLS 文件 |

内容包括 `title`、Markdown `content`、`tags`、`collection_id`、`favorite`、`source_url` 和 `captured_at`。更新时提供当前 `version`，冲突时返回错误以避免覆盖其他设备编辑。

上传提供 `source_url` 会在备注中追加来源，并附加网站标签。相同文件的重复采集保留原说明，补充新的来源。

### 多标签与连续浏览

`GET /api/stats` 与 `GET /api/tags` 同样支持 `collection`，前端始终传入当前知识库；省略参数仍可供脚本获取全局统计。`unfiled` 表示未分类。

`GET /api/items` 支持 `kind=image|video|note`、`collection`、`q`、`tags`、`tag_mode` 等查询。`tags` 为 URL 编码后的 JSON 数组；`tag_mode=all` 表示交集，`any` 表示并集。`collection=unfiled` 仅查看未分类。

`gallery=true` 返回当前筛选与排序范围的图片 ID 顺序，支持前端连续翻图。

### 配图归档与批量删除

创建笔记或更新笔记 `content` 时默认尝试归档外部配图，返回 `image_archive: { total, archived, failures }`。成功图片使用 `/media/...` 内部地址；失败保留网址与提示，可再次保存重试。`archive_images: false` 可显式保留外链。单次最多 200 张 / 500 MB，服务器尝试约两分钟后返回剩余失败项；单张最多 25 MB。服务器不获取本机、内网或凭据 URL，浏览器扩展可利用用户已有站点访问状态上传配图。

批量回收站接口接收 `{ items: [{ id, version }], collection_id, restore: false }`；`restore: true` 为恢复，`collection_id: null` 为未分类。每次最多 100 项，要求所有条目属于指定知识库、版本及删除状态一致，失败时整体回滚。

### HLS 分片

`POST /api/streams` 的 multipart `files` 上传本地化清单与媒体分片，附加标题、来源、知识库和 JSON 标签。`?mode=download` 仅返回合并的 MP4，不创建内容条目。

只允许受校验的包内路径；最多 1203 个文件、合计 500 MB、单清单 2 MB。FFmpeg 不从网络读取分片，合并不重新编码。支持完整点播及普通 AES-128，不支持 DRM、DASH 或持续直播录制。

## 事件与 Webhook

`GET /api/events?after=cursor` 每页最多 100 条。事件包含 `id/type/item_id/created_at`；消费后保存游标。类型为 `item.created`、`item.updated`、`item.deleted`、`item.restored`。

Webhook 可在设置中创建，也可通过管理员接口 `/api/webhooks` 管理。持久队列支持失败重试、暂停和手动重发。语义是至少一次投递，接收端必须按投递 ID 去重。

请求头：

- `webhook-id`：稳定投递 UUID。
- `webhook-timestamp`：本次请求的 Unix 秒时间。
- `webhook-signature`：`v1,` 加 HMAC-SHA256 的 Base64 结果。

签名原文为 `id.timestamp.原始JSON正文`，密钥为 `whsec_` 后的 Base64 解码字节。接收器同时校验时间窗和签名。密钥仅创建时返回一次。

参见 [可运行接收器](../examples/webhook-receiver.mjs)、[事件轮询示例](../examples/events.mjs) 和 [素材采集示例](../examples/clip.mjs)。项目提供集成接口，没有在服务端执行任意第三方插件的沙箱。

## 扩展一键连接

`POST /api/clipper/pair` 由管理员浏览器会话签发 2 分钟有效的单次凭据。`POST /api/clipper/redeem` 仅允许扩展来源兑换为 write 令牌；凭据不可重放，管理员会话注销或过期后失效。普通网页不会收到扩展的明文 API 令牌。
