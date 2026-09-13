# 参与 ZNote

欢迎通过 [功能建议](https://github.com/BorderArea01/ZNote/issues/new/choose)、[讨论](https://github.com/BorderArea01/ZNote/discussions) 或 Pull Request 参与。较大改动建议先说明目标和兼容性，避免重复工作。

## 开发与验证

1. 使用 Node.js 24，运行 `npm ci`。
2. 使用独立测试数据目录，不在私人知识库上调试删除、迁移和恢复。
3. 后端运行 `npm start`，前端运行 `npm run dev`。
4. 提交前运行 `npm test` 与 `npm run build`；客户端修改按 [客户端文档](docs/CLIENTS.md) 构建。
5. 界面修改提供桌面与手机截图。声明实际验证的系统，未测试的平台不要写“已验证”。

保持知识库隔离、原文件可恢复、图片组顺序、笔记配图关系和 API 兼容性。涉及数据的改动应覆盖失败、重试及恢复路径。不要提交 `data/`、签名密钥、私人素材、运行日志或生成的安装包。

## Pull Request

说明具体问题、最终行为、验证结果与迁移影响。引用第三方代码时保留来源和许可证；提交者应具有贡献相关代码的权利。贡献采用仓库声明的许可证，不改变第三方组件原有授权。
