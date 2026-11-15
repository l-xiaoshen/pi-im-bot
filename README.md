# Pi IM Bot

基于 Bun、TypeScript 和 Pi Durable 的 IM Agent 宿主，支持 Mock 调试、NapCat / OneBot v11、OpenAI Responses provider、HTTP MCP、Skill、插件和 Shipyard 沙盒。

## 快速开始

```sh
bun install --frozen-lockfile
bun run dev
```

- Bot API：`http://localhost:19335`
- 工作台：`http://localhost:3000`
- 首次启动从 `config/*.example.json` 生成实际配置。
- 配置与数据默认位于 `config/`、`data/`，可通过 `BOT_CONFIG_DIR`、`BOT_DATA_DIR` 调整。

生产模式先运行 `bun run build`，再分别运行 `bun run start:bot`、`bun run start:web`。监听地址、跨域、公网访问地址和 Docker 部署见 [部署配置](docs/configuration.md)。

## 使用工作台

### Mock 聊天

1. 新建群聊或私聊。
2. 选择「离线演示」体验真实 Pi 工具循环，不访问上游模型。
3. 在「模型与 Provider」添加并测试模型，然后切换到「真实模型」。
4. 在「记录」中查看任务、provider 尝试、工具调用和 token 用量。

Mock 与 QQ 共用会话、任务、工具和交付逻辑。真实请求失败不会自动切换为演示回复。

### QQ / NapCat

在 NapCat 添加反向 WebSocket 客户端：

```text
ws://bot.example:19335/onebot/v11/ws
```

在工作台的「QQ 接入」配置 Token 和测试目标。目标按机器人 QQ 号与群号绑定；启用后，普通消息只记录，以下输入触发 Agent：

```text
!pi 你好
@Bot 你好
```

连接设置保存后立即应用。页面显示连接状态、认证错误和消息路由结果。

## 会话与权限

「Bot 设置」管理人格、回复偏好、消息投影、行为、模型组和工具权限，按以下顺序覆盖：

```text
默认 → 账号 → 聊天范围 → 当前对话
```

恢复继承会删除本层覆盖；空字符串、空集合和 `false` 都是有效覆盖值。受理任务时固定配置版本，工具调用前仍检查最新权限。

平台账号下包含群或私聊渠道，每个渠道可有多个会话上下文。群成员共享当前会话的人格和历史，但调用权限按触发身份分别计算；多人合批时权限取交集。详见 [会话范围与权限](docs/framework/conversation-scope.md)。

框架职责和更多专题见 [Bot 框架文档](docs/framework/README.md)。

## 模型与 Provider

在「模型与 Provider」中：

1. 新增提供商，填写 OpenAI Responses API 基址和认证方式。
2. 获取或手动添加模型，设置上下文、输出和图片能力。
3. 测试模型，并将主选模型加入候选组。
4. 在 Bot 设置或聊天工具栏选择默认组或会话级模型组。

API 基址通常以 `/v1` 结尾，不包含末尾的 `/responses`。密钥和敏感 Header/Body 不回显，留空或保留占位表示不修改。配置保存在 `config/providers.json`；手动编辑后使用「从文件重载」。

每次请求按候选组顺序尝试，失败流不会提交给 Pi，成功的响应才进入工具循环。任务优先复用已成功候选，冷却结束后恢复首选；取消不会继续尝试备用模型。未返回 usage 的兼容服务无法完整统计 token，工作台不估算费用。

## MCP、Skill 与媒体

- **MCP**：登记 Streamable HTTP 服务、Headers 和调用期限，支持标准 MCP Tasks 的持久后台执行。详见 [外部任务与 Cron](docs/framework/external-tasks.md)。
- **Skill**：导入含 `SKILL.md` 的固定版本目录，使用 `/skills` 和 `/skill ID 内容` 加载；导入不会执行包内代码。
- **工具收纳**：选择全量装载或按需搜索。稳定能力 ID 用于授权，模型别名只用于调用。
- **媒体**：支持附件、图片视觉输入和消息引用；媒体按需下载，URL、签名和宿主路径不提供给模型。详见 [媒体与引用](docs/framework/media.md)。

长工具结果保存为会话产物，通过 `artifact_read` 分页读取，避免重复占用模型上下文。

## 后台任务与沙盒

群主对话一次执行一个推理，后台 Agent、MCP 和 Shell 操作使用独立 Job 与工作区。工作台可创建、修订、停止任务和下载结果；任务完成后交付结果，不额外调用模型总结。

Pi 文件和 Shell 工具可委托给 Shipyard/Bay 容器，配置方法见 [执行后端](docs/configuration.md#执行后端)。未配置时执行后端为 `disabled`；后端故障不会回退到宿主文件或 Shell。

常用指令：

| 指令 | 用途 |
| --- | --- |
| `/help`、`/status` | 查看帮助或状态 |
| `/stop` | 停止当前范围的在途和排队任务 |
| `/new` | 新建会话，保留 IM 记录和工作区 |
| `/jobs`、`/job ID` | 查看后台任务 |
| `/job cancel ID` | 停止任务 |
| `/job update ID 版本号 补充说明` | 修订 Agent 任务 |
| `/skills`、`/skill ID 内容` | 查看或选用 Skill |

Cron 支持 IANA 时区、独立或共享上下文、防重叠、暂停和定向停止。持久运行状态位于 `data/agent.sqlite`，IM、任务、交付和计划状态位于 `data/bot.sqlite`。

## 插件

「插件中心」支持静态目录、GitHub、ZIP 上传和开发目录安装，提供 schema 配置、实例启停、能力授权、服务绑定和运行诊断。新配置的插件执行默认关闭，在「运行环境」准备依赖后可启用；安装成功不代表当前范围已经可执行。

插件以独立 Worker 运行，可提供 Pi 工具、直接指令、Hook 和后台 Job。插件数据、代码快照和发布产物分别管理，发布 ZIP 不包含实例配置或数据。

- [插件中心使用](docs/framework/plugin-management.md)
- [插件开发手册](docs/plugins/README.md)
- [插件存储与部署](docs/framework/plugin-storage.md)

```sh
bun run pack:plugin examples/plugins/echo /tmp/echo.zip
```

## 数据与安全

| 路径 | 内容 |
| --- | --- |
| `config/` | Bot、Provider、资源及分层设置 |
| `data/bot.sqlite` | 消息、Job、轨迹、交付账本和计划 |
| `data/agent.sqlite` | Pi 对话、durable 执行记录和恢复状态 |
| `data/artifacts/` | 会话产物 |
| `data/shipyard-workspaces/` | Shipyard 工作区绑定 |
| `data/configuration-snapshots/` | 私有运行配置快照，可能包含凭据 |

备份应包含配置、数据、插件快照和插件数据，并保护其中的凭据。外部操作或平台发送的回执未知时，系统保留未知状态，不盲目重放。

## 开发

```sh
bun run check
bun run build
bun run format:check
```

主要目录：`apps/web/`（工作台）、`services/bot/`（API 与组合入口）、`pkgs/`（领域包）、`examples/plugins/`（插件示例）、`scripts/`（开发与发布工具）。

参考：[Pi SDK](https://github.com/earendil-works/pi/blob/v1.5.0/packages/coding-agent/docs/sdk.md) · [OpenAI Responses](https://developers.openai.com/api/reference/resources/responses/methods/create)
