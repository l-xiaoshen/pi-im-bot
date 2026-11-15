# 部署配置

运行配置保存在 Git 忽略的 `config/`，启动环境保存在 `.env.local`。示例文件只放空值或无害示例，不放真实凭据。

## Bot 与工作台

开发模式运行 `bun run dev`。生产模式先运行 `bun run build`，再分别运行 `bun run start:bot` 和 `bun run start:web`。

| 设置                    | 来源                                           | 应用方式             |
| ----------------------- | ---------------------------------------------- | -------------------- |
| Bot 监听地址            | `config/bot.json` 的 `server`                  | 重启 Bot             |
| 配置、数据目录          | `BOT_CONFIG_DIR`、`BOT_DATA_DIR`               | 启动时读取           |
| 浏览器可访问的 Bot 基址 | `BOT_PUBLIC_ORIGIN`                            | 重启 Web             |
| 允许跨域的工作台来源    | 逗号分隔的 `BOT_WEB_ORIGINS`                   | 重启 Bot             |
| 工作台监听地址          | `WEB_HOST`、`WEB_PORT`                         | 重启 Web             |
| Provider                | 模型与 Provider 页面或 `config/providers.json` | 页面保存，或手动重载 |
| MCP、Skill、插件目录    | 对应资源页面，保存到 `config/resources.json`   | 保存并刷新           |
| OneBot 连接与目标       | QQ 接入页面，保存到 `config/bot.json`          | 保存后立即应用       |

API、事件流、产物链接和页面展示的 OneBot 地址使用 `BOT_PUBLIC_ORIGIN`。它必须是浏览器与 NapCat 实际可达的 Bot 基址，不能直接填写只有容器网络可解析的名称。跨域工作台必须显式加入 `BOT_WEB_ORIGINS`；OneBot 使用自身的 Token 鉴权。

仓库提供 `services/bot/Dockerfile`、`apps/web/Dockerfile` 和双服务 `compose.yaml`。配置、Bot 数据、插件代码与插件数据分别持久化；容器部署仍需准备运行环境所需的实际依赖。

## 执行后端

在 `config/bot.json` 配置 Shipyard/Bay：

```json
{
  "agent": {
    "execution": {
      "backend": "shipyard",
      "endpoint": "http://127.0.0.1:8114",
      "apiKeyEnv": "BAY_API_KEY",
      "profile": "python-default",
      "timeoutMs": 30000,
      "commandTimeoutSeconds": 120,
      "maxFileBytes": 5242880
    }
  }
}
```

也可用 `apiKey` 保存凭据，或用 `apiKeyEnv` 指向启动环境中的变量。Bot 在容器中运行时，`endpoint` 应使用 Bot 容器可达的 Bay 地址。

每个聊天范围在首次使用工具时绑定独立 sandbox/Cargo，跨任务和重启复用，绑定记录位于 `data/shipyard-workspaces/`。容器内 `/workspace` 持久保存；其他临时路径是否保留由容器生命周期决定。

Pi 的 `read/write/edit/ls/bash` 均通过 Bay 公开操作接口执行，不调用宿主文件或 Shell。未配置时 `backend` 为 `disabled`；连接失败、绑定丢失或 endpoint/profile 冲突会明确报错，不回退宿主执行。取消会先中断容器内相关进程，再停止计算并保留 Cargo。

## 插件开发源

Bot 与 `pi-im-bot-plugins` 默认并列放置。在插件仓库创建 `.env.local`：

```dotenv
PLUGIN_SOURCE_PUBLIC_URL=http://plugins.example:19337
```

启动源服务：

```sh
bun --env-file=.env.local run source
```

将同一基址下的 `index.json` 登记到 Bot 的「插件中心 → 管理目录源」。`PLUGIN_SOURCE_PUBLIC_URL` 可以包含路径前缀，但不能包含凭据、查询参数或 fragment；未设置时使用 `http://localhost:<PLUGIN_SOURCE_PORT>`，端口默认为 19337。

可选启动项包括 `PLUGIN_SOURCE_PORT`、`PLUGIN_SOURCE_WATCH`、`PI_IM_BOT_SOURCE`。Bot 位于容器或另一台机器时，不要使用指向 Bot 自身的 `localhost`。

构建子进程不继承完整 `.env.local` 或上游凭据。插件 API 文档更新后，在插件仓库运行 `bun run docs:sync` 同步作者手册快照。

## 源码导出

```sh
bun run share:export . /tmp/pi-im-bot-public
bun run share:export ../pi-im-bot-plugins /tmp/pi-im-bot-plugins-public
```

输出目录必须不存在，且位于输入仓库之外。导出基于 Git 文件清单，并包含未忽略的未提交源码。分享前检查导出内容、`.gitignore` 和凭据扫描结果，不包含真实环境、配置、运行数据或本地审阅文件。
