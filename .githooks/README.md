# 本机推送保护

维护前执行 `git config core.hooksPath .githooks`。钩子拒绝直接向 main、master、发布分支或标签推送；功能分支仍可正常推送。主分支通过当前 PR 最新提交的必需检查后合并，发布工具核对提交与产物后创建标签。

本机钩子不能替代远端分支保护或 CI，也不授权用 `--no-verify` 绕过。资源检查、验证以及 PR 最新 head 的检查仍按 AGENTS.md 执行。
