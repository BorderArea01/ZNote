# 宣传片维护工具

动效画面在 `index.html`，台词与时长在 `storyboard.json`；[分镜说明](../../docs/promo/README.md)与主 README 同步介绍产品。

从仓库根目录运行：

```sh
npm install --prefix tools/promo
node tools/promo/generate-neural-voice.mjs all
node tools/promo/fit-voice.mjs
node tools/promo/make-music.mjs
node tools/promo/make-captions.mjs
node tools/promo/render.mjs --stills
node tools/promo/render.mjs --video
node tools/promo/mix.mjs warm
node tools/promo/mix.mjs lively
node tools/promo/verify.mjs
```

需要本机 Microsoft Edge、仓库的 Playwright / Sharp 与 `ffmpeg-static`。语音生成使用在线神经语音服务，需要联网；服务可能变更，输出音频仍需核对。预览、成片和媒体缓存保存在 `output/promo-znote`。生成失败不覆盖已审核的发布文件；最终成片检查音视频、字幕、首尾画面和时长后再对外发布。

图标以 `public/icon.svg` 为源。更换图标时同时替换动效页面中的 `logo`，运行 `npm run clients:icons` 更新客户端与扩展图标。公开宣传材料仅提及“其他插件”，不列出私人扩展下载地址。
