# 开发、验证与分发

## 开发工作区

插件开发目录默认为相邻的 `../pi-im-bot-plugins`：

```sh
cd ../pi-im-bot-plugins
bun install --frozen-lockfile
bun run docs:sync
bun run check
bun test tests
bun run build status
bun run pack status /tmp/system-status.zip
```

`PI_IM_BOT_SOURCE` 可指定 Bot 源码目录，默认使用相邻仓库。工作区采用 `plugins/<id>/src/index.ts` 入口，build 将公共 SDK 和依赖打包到 `dist/index.mjs`。

`@pi-im-bot/plugin-sdk` 是工作区别名，不是已发布的 npm 包。发布前必须构建，或确保原入口及依赖都能被 Worker 直接解析。build 校验公共 API 文档快照，变化时先运行 `docs:sync`。

## 验证与安装

建议分层验证：

1. 纯解析、格式化和渲染测试。
2. 使用 Bot fixture 验证指令、工具、RPC、权限和取消。
3. 在临时配置和数据目录中验证安装、表单与 Mock 交付。
4. 按实际部署条件验证容器、上游服务和平台能力。

fixture 不能证明操作系统或容器隔离，也不应使用真实群消息或付费模型代替可控测试。测试直接指令时，可同时断言未发生模型请求。

安装后实例保持停用。检查配置、服务依赖、grants、范围、触发人权限和执行环境，再按部署需求启用。包导入不会执行入口。

`files` 应包含运行代码、模板、字体和 WASM。不要把真实配置、`.env`、缓存、临时产物、数据卷或日志打入发布包。

## 本地源与发布

开发源使用标准目录协议，配置见 [部署配置](../configuration.md#插件开发源)：

```sh
bun run source
```

源服务监听变化并发布固定摘要 ZIP；Bot 刷新目录后由用户手动安装或更新。发布目录与安装、启用是独立操作。

GitHub 发布建议附带构建后的 `plugin.zip`。源码安装也受支持，但消费者不会执行 npm install/build，因此仓库必须包含可运行入口与包内可解析依赖。固定分支、标签或目录链接时会先解析 commit。

静态目录索引包含 id、name、description、version、author、categories、`apiVersion: 1`、ZIP URL 和 SHA-256。目录内容、代码 revision、实例设置和数据是不同对象；更新失败不会替换当前代码。

## 管理界面约定

实例配置编辑 schema 与声明服务，账号、范围和 conversation 覆盖在各自范围编辑。强制更新使用安装时保存的来源，目录和 GitHub 可重新获取；上传 ZIP 需手动提供新文件。

实例管理 API 使用乐观 revision 和字段级 patch。省略字段保持原值，空数组或空映射可明确清空相应字段；业务 settings 通过实例配置路由保存，不与启停、grants 或服务绑定混合提交。
