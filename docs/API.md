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

## 笔记版本

- `GET /api/items/:id/versions` 返回 `{ versions: [{ id, version, title, saved_at }] }`，按保存版本倒序。
- `GET /api/items/:id/versions/:versionId` 返回该版本的 `id/version/saved_at/title/content/tags`。
- 通过普通 `PATCH /api/items/:id` 提交选用的旧正文，并传入**当前笔记**的 `version`；冲突与本地图片引用检查仍然生效。读取历史不会修改笔记。

支持现有 read/write 令牌和管理员会话。记录上限为每篇 50 个、压缩后 8 MiB；仅收藏或移动不重复保存相同正文。普通删除保留历史，永久删除笔记会删除其历史。浏览器本地草稿未上传，不属于这些接口。

## 常用接口

批量整理、标签、回收站操作、整组移动 / 收藏和 `PATCH /api/items/:id` 可传入 `undo: true`，返回 `undo` 操作摘要（没有实际字段变化时为 `null`）。未传入时保持原行为。

`GET /api/undo` 查询当前会话或 API 令牌的最近操作；`POST /api/undo/:id` 撤销该操作。重复撤销同一记录不会重复写入，返回 `already_undone: true`。相关字段冲突返回 409，过期或其他会话的记录返回 410。永久删除不提供撤销。记录保留 24 小时、至多 50 条，压缩总量上限 32 MB；完整备份恢复后作废。

撤销笔记编辑会还原正文和该事务内的配图关联；此前完成的上传、网络归档和原文件保存仍然保留，可在素材库单独整理。

`GET /api/items` 支持 `anchor=<内容 ID>`：按当前知识库、标签、分类和排序定位该项所在分页，返回实际 `offset`，不需要下载此前所有页面。定位项不存在或不符合筛选时回到第 1 页；默认分页行为不变。结果的 `event_cursor` 可与 `GET /api/events?latest=true` 返回的游标比较，判断是否有更新；普通事件增量读取接口保持不变。

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

批量回收站接口接收 `{ items: [{ id, version }], collection_id, restore: false }`；`restore: true` 为恢复，`collection_id: null` 为未分类。每次最多 10,000 项，要求所有条目属于指定知识库、版本及删除状态一致，失败时整体回滚。

### HLS 分片

`POST /api/streams` 的 multipart `files` 上传本地化清单与媒体分片，附加标题、来源、知识库和 JSON 标签。`?mode=download` 仅返回合并的 MP4，不创建内容条目。

只允许受校验的包内路径；最多 1203 个文件、合计 500 MB、单清单 2 MB。FFmpeg 不从网络读取分片，合并不重新编码。支持完整点播及普通 AES-128，不支持 DRM、DASH 或持续直播录制。

## 图片组与标签

`GET /api/item-groups/order?id=条目ID` 获取同一知识库内完整图片组的 `items`、`cover_id`、`note_id` 和 `revision`。条目可为组内图片或所属笔记。

`POST /api/item-groups/order` 接收 `{ id, revision, ids: [按展示顺序排列的全部图片ID], sync_note: true }`。第一张为封面；必须提交同组全部有效图片且不重复，组成员或版本变化返回 409，所有修改回滚。笔记配图默认同步正文图片位置（文字和链接保留），`sync_note: false` 仅调整素材库组顺序。成功返回新快照及更新后的锚点 `item`。需要 write 权限。

`group_order` 为可空的展示顺序，空值沿用 `group_index` 原始页序；上传仍使用原始 `group_index`，不要用展示顺序覆盖来源页码。`gallery=true&group_key=...&collection=...` 返回展示顺序，手动排序不破坏再次采集的去重。

`POST /api/item-groups/move` 接收 `{ id, version, collection_id, move_note: true }`。`id` 是组内任意图片，`version` 是当前版本，`collection_id: null` 表示未分类。移动同一源知识库中的整组图片；笔记配图同时移动所属笔记。可附带当前图片的 `title/content/tags` 编辑，成功返回图片对象和 `moved_count`。目标已有同组或重复内容时返回 409，所有更新一起回滚。

保存笔记时，本地配图自动归入 `note:笔记ID`；共享原文件但保留每篇笔记独立的分组与顺序。更新笔记知识库或通过 `batch-organize` 移动笔记，也会一起移动配图。普通单图片移动接口仍可用于单页整理。

`GET /api/tags?collection=知识库ID` 只返回指定库的标签。`collection=unfiled` 或省略参数时只返回未分类内容的标签，不再默认返回所有知识库的标签。

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

## 视频首帧封面

视频条目的 `thumbnail_url` 指向 `/media/:id/thumbnail`，返回首帧 WebP，最长边不超过 480px。与原视频使用相同的访问鉴权，旧视频也按需生成，无需重新上传。解码组件缺失、无法解码或超时返回 503，原视频地址仍可正常访问。完整备份保存原视频，恢复后可重新生成封面。

### 永久删除回收站内容

1. POST /api/trash/preview，JSON：`{ "collection_id": "知识库 ID", "ids": ["条目 ID"] }`。collection_id 必填，null 表示未分类；省略 ids 表示当前库整个回收站，指定 ids 每次最多 10,000 项。
2. 返回 count、revision、referenced、shared、reclaimable_bytes。确认后 POST /api/trash/purge，带同一选择范围、revision 和 `confirm: "DELETE"`。
3. 内容或引用变化返回 409，须重新预览、确认。成功返回上述字段及 freed_bytes、freed_files、pending_files；待清理原文件会自动重试。写入令牌可用，只读令牌不可用。清空不会跨知识库，不能永久删除活动条目。

移入回收站与永久删除会保留笔记的独立配图，自动替换其 Markdown 内部地址；笔记不再引用删除条目。保存笔记引用回收站或不存在的条目返回 409，须先恢复或换用有效配图。条目及笔记版本号可能随配图替换更新，请使用响应中的最新版本。媒体读取接口保留回收站预览能力，但不允许将该地址重新写入笔记。

`GET /api/item-groups/selection?id=图片ID`：返回同知识库、同分组、同回收站状态的全部图片 `{ items: [{id, version}], collection_id, group_key, trash }`，不受筛选或分页影响。支持笔记 ID 获取活动笔记配图；最多 10,000 项，超限返回错误，不截断选择。批量标签/整理/删除/恢复支持同样上限。完整选中某笔记的活动配图后批量移动，会同时移动该笔记。
