# 第三方组件

正文配图解析使用 unified / remark-parse 及其 Markdown 解析依赖（MIT）；扩展随附汇总许可文件 `extensions/clipper/vendor/markdown-LICENSES.txt`。源码：[unified](https://github.com/unifiedjs/unified)、[remark](https://github.com/remarkjs/remark)。Pawchive 选择器依据用户提供的 PawPreviewer 项目结构适配，未包含其中的个人作者列表、配置或数据。

下表列出主要组件。第三方组件分别遵循其许可证；本文件不替代依赖包或可执行文件随附的完整许可文本。ZNote 自有代码采用 [GPL-3.0-or-later](LICENSING.md)。

| 组件 | 用途 | 许可证 / 来源 |
| --- | --- | --- |
| React | 网页界面 | [MIT](https://github.com/facebook/react) |
| remark-breaks | 笔记预览保留回车换行 | [MIT](https://github.com/remarkjs/remark-breaks) |
| Electron / Chromium | 桌面窗口与浏览器运行时 | [Electron MIT 与 Chromium 第三方许可](https://github.com/electron/electron/blob/main/LICENSE)；安装包保留 LICENSE / LICENSES.chromium.html |
| Node.js | 内置本机服务运行时 | [Node 及其捆绑组件许可](https://github.com/nodejs/node/blob/main/LICENSE)；runtime/NODE-LICENSE 对应实际打包版本 |
| electron-builder | 桌面安装包构建 | [MIT](https://github.com/electron-userland/electron-builder) |
| Gradle / Android Gradle Plugin | Android 客户端构建 | [Gradle Apache-2.0](https://github.com/gradle/gradle) / [Android 开源项目](https://source.android.com/docs/setup/about/licenses) |
| Vite / esbuild | 网页和扩展构建 | [Vite MIT](https://github.com/vitejs/vite) / [esbuild MIT](https://github.com/evanw/esbuild) |
| Express | HTTP API | [MIT](https://github.com/expressjs/express) |
| Sharp | 图像读取与缩略图 | [Apache-2.0](https://github.com/lovell/sharp)；其原生依赖另有许可 |
| LinkeDOM 0.18.12 | 服务端 HTML 解析（不运行网页脚本） | [ISC](https://github.com/WebReflection/linkedom/blob/main/LICENSE) |
| Mozilla Readability 0.6.0 | 正文提取 | [Apache-2.0](extensions/clipper/vendor/readability-LICENSE.md) |
| Turndown 7.2.4 | HTML 转 Markdown | [MIT](extensions/clipper/vendor/turndown-LICENSE) |
| turndown-plugin-gfm 1.0.2 | Markdown 表格等扩展 | [MIT](extensions/clipper/vendor/turndown-gfm-LICENSE) |
| HLS.js 1.6.15 | 扩展 HLS 预览 | [BSD-2-Clause](extensions/clipper/vendor/hls.LICENSE) |
| MediaInfo / mediainfo.js | 视频元数据检查 | [项目与许可](https://github.com/buzz/mediainfo.js) |
| yt-dlp | 可选平台视频解析 | [项目与发行许可](https://github.com/yt-dlp/yt-dlp) |
| FFmpeg / ffmpeg-static | 可选音视频无损合并 | [FFmpeg 许可](https://ffmpeg.org/legal.html) / [预编译组件说明](https://github.com/eugeneware/ffmpeg-static) |

已打包进浏览器扩展的 Readability、Turndown、GFM 和 HLS.js 附带许可证；重建正文脚本使用 `npm run clipper:build`。FFmpeg 与 yt-dlp 可执行文件不进入仓库，由安装脚本或系统提供；其许可证和来源信息应随可执行文件保留。

完整依赖版本与完整性校验记录在根目录和 `clients/desktop/` 的 `package-lock.json`。桌面运行时保留依赖包的许可文本；FFmpeg / yt-dlp 可执行文件不随桌面包分发，可选安装从上游获取并保留来源文件。独立插件的第三方许可由各自项目保留。文档图片来源见 [图片说明](docs/images/README.md)，包含原创演示素材和用户提供、已遮挡摘要的微信入口图。
