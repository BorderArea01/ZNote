# 第三方组件

下表列出主要组件。第三方组件分别遵循其许可证；本文件不替代依赖包或可执行文件随附的完整许可文本，也不为本项目自有代码指定许可证。

| 组件 | 用途 | 许可证 / 来源 |
| --- | --- | --- |
| React | 网页界面 | [MIT](https://github.com/facebook/react) |
| Vite / esbuild | 网页和扩展构建 | [Vite MIT](https://github.com/vitejs/vite) / [esbuild MIT](https://github.com/evanw/esbuild) |
| Express | HTTP API | [MIT](https://github.com/expressjs/express) |
| Sharp | 图像读取与缩略图 | [Apache-2.0](https://github.com/lovell/sharp)；其原生依赖另有许可 |
| Mozilla Readability 0.6.0 | 正文提取 | [Apache-2.0](extensions/clipper/vendor/readability-LICENSE.md) |
| Turndown 7.2.4 | HTML 转 Markdown | [MIT](extensions/clipper/vendor/turndown-LICENSE) |
| turndown-plugin-gfm 1.0.2 | Markdown 表格等扩展 | [MIT](extensions/clipper/vendor/turndown-gfm-LICENSE) |
| HLS.js 1.6.15 | 扩展 HLS 预览 | [BSD-2-Clause](extensions/clipper/vendor/hls.LICENSE) |
| MediaInfo / mediainfo.js | 视频元数据检查 | [项目与许可](https://github.com/buzz/mediainfo.js) |
| yt-dlp | 可选平台视频解析 | [项目与发行许可](https://github.com/yt-dlp/yt-dlp) |
| FFmpeg / ffmpeg-static | 可选音视频无损合并 | [FFmpeg 许可](https://ffmpeg.org/legal.html) / [预编译组件说明](https://github.com/eugeneware/ffmpeg-static) |

已打包进浏览器扩展的 Readability、Turndown、GFM 和 HLS.js 附带许可证；重建正文脚本使用 `npm run clipper:build`。FFmpeg 与 yt-dlp 可执行文件不进入仓库，由安装脚本或系统提供；其许可证和来源信息应随可执行文件保留。

完整依赖版本与完整性校验记录在 `package-lock.json`。文档截图使用测试代码生成的示例素材，不包含私人知识库内容。
