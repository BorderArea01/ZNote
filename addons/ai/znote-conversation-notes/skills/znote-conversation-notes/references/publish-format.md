# 发布格式与私密配置

## 笔记 JSON

```json
{
  "title": "为什么 WebP 通常比 PNG 更小",
  "content": "# 为什么 WebP 通常比 PNG 更小\n\n{{image:compression}}\n\n正文……",
  "tags": ["图像压缩", "WebP", "AI 对话整理"],
  "collection_name": "技术学习",
  "source_url": null,
  "images": [
    {
      "key": "compression",
      "path": "C:/Temp/compression.png",
      "alt": "PNG 与 WebP 编码流程对比",
      "caption": "WebP 同时利用预测、变换和熵编码减少冗余。"
    }
  ]
}
```

- `title`、`content` 必填。
- `collection_id`、`collection_name` 二选一；都省略时使用默认知识库，再回退到未分类。
- `source_url` 只放原始对话的稳定 HTTP(S) 分享地址；没有就用 `null`。
- `images` 最多 20 张。`key` 对应正文中的 `{{image:key}}`；未引用的图片追加到“相关图片”。
- 图片必须是本地 JPEG、PNG、WebP、GIF 或 AVIF，单张遵循当前 ZNote 上限。

## 命令

```text
node scripts/znote-note.mjs collections
node scripts/znote-note.mjs doctor
node scripts/znote-note.mjs publish --input note.json
```

首次配置时，把 JSON 通过标准输入传给脚本，避免令牌进入命令行历史：

```text
node scripts/znote-note.mjs configure
```

标准输入内容：

```json
{"base_url":"http://localhost:3741","token":"zn_...","default_collection_id":null}
```

配置保存在用户目录而非仓库：Windows 为 `%APPDATA%/ZNote/conversation-notes.json`，Linux/macOS 为 `${XDG_CONFIG_HOME:-~/.config}/znote/conversation-notes.json`。也可只设置 `ZNOTE_API_TOKEN`、`ZNOTE_BASE_URL` 和可选的 `ZNOTE_COLLECTION_ID` 环境变量。

令牌应为 ZNote 的 `write` 令牌。脚本输出不会回显令牌。
