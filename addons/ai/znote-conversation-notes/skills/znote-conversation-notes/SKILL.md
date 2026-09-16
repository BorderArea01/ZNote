---
name: znote-conversation-notes
description: Turn a ChatGPT, Claude, Gemini, Copilot, or other AI conversation into a concise, illustrated learning note, and optionally save it to ZNote. Use when the user asks to整理、归纳、复盘、提炼或入库一段 AI 对话；do not use for ordinary meeting minutes or verbatim chat export.
---

# ZNote 对话学习笔记

把当前对话或用户提供的聊天记录改写成一篇脱离原对话也能读懂、以后能复习和复用的 Markdown 笔记。先整理内容，再按用户的明确要求决定是否写入 ZNote。

## 整理内容

1. 确认范围。默认使用与主题直接相关的完整对话；忽略寒暄、工具日志、重复追问和已经被纠正的旧结论。若用户指定片段、文件或时间范围，以指定范围为准。
2. 区分证据强度：把已经验证的事实、对话中的主张、模型建议和仍待确认的事项写清楚，不把模型猜测改写成事实。
3. 选择适合主题的结构，不机械套模板。通常应覆盖：
   - 问题与结论；
   - 关键概念、原理或推理链；
   - 有价值的例子、代码、公式、链接或对比；
   - 可迁移的方法、步骤或检查清单；
   - 易错点、限制和待验证问题；
   - 3–5 个复习问题，答案能从正文推出。
4. 保留必要上下文，让未参与对话的人也能理解。删掉过程噪声，合并同义内容，避免逐条复述双方发言。
5. 标题具体、可检索。标签优先使用主题、领域和内容类型，并加入 `AI 对话整理`；不要用 `其他`、`杂项` 等弱标签。

详细质量标准和示例见 [references/note-quality.md](references/note-quality.md)。

## 处理图片

- 优先使用对话里真正参与论证的截图、图表、示意图和结果图。每张图写有信息量的替代文本；需要时加一句图注，说明它证明或解释什么。
- 若生成图片的工具可用，且一张流程图、结构图或对比图能明显降低理解成本，可生成一张；不要为了“图文”加入装饰图。
- 不把含令牌、密码、私人聊天或无关个人信息的截图入库。无法确认时省略该图并说明。
- 发布脚本会先把本地 JPEG、PNG、WebP、GIF 或 AVIF 上传到 ZNote，再写入内部 `/media/…` 地址。不要在最终笔记中留下本地路径。外部图片只有在用户允许且 ZNote 成功归档后才算完成。

## 写入 ZNote

仅当用户要求“保存、入库、写进 ZNote”等外部写入动作时发布；只要求整理或预览时，返回 Markdown 草稿即可。

1. 把标题、Markdown、标签及可选图片写成临时 JSON。格式见 [references/publish-format.md](references/publish-format.md)。不要把 API 令牌写进临时文件。
2. 以本 `SKILL.md` 所在目录为基准解析脚本路径，不要假设当前工作目录就是 Skill 目录。运行：

   ```text
   node scripts/znote-note.mjs publish --input <临时 JSON 路径>
   ```

3. 脚本会使用 `ZNOTE_API_TOKEN` / `ZNOTE_BASE_URL`，或用户目录中的私密配置。若尚未配置，按 [references/publish-format.md](references/publish-format.md) 的无回显方式配置。
4. 未指定知识库时使用私密配置里的默认知识库；仍未配置则放入“未分类”。不要擅自新建知识库。
5. 发布成功后报告笔记标题、知识库、图片归档结果和可打开的地址。失败时保留 Markdown 与临时 JSON；超时后先用同一文件重试，脚本会用内容标记避免生成重复笔记。

不要在回答、命令参数、日志或仓库文件中显示令牌。
