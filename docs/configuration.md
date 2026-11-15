# 部署配置

公开源码与示例不绑定特定主机。运行配置保存在被 Git 忽略的 `config/`；启动环境保存在各仓库被忽略的 `.env.local`。只把空值或无害示例放进 `.env.example`。

## Bot 与工作台

开发时从仓库根目录执行 `bun run dev`，分别启动 Bot API 和独立工作台。首次启动会从 `config/*.example.json` 创建实际配置。API 默认位于 `http://localhost:19335`，工作台默认位于 `http://localhost:3000`。生产模式先执行 `bun run build`，再分别执行 `bun run start:bot` 和 `bun run start:web`。LAN 客户端使用部署主机的可达地址。

| 设置 | 唯一来源 | 修改后 |
| --- | --- | --- |
| 监听 host/port | `config/bot.json` 的 `server` | 重启进程 |
| 插件目录入口 | 工作台 → 插件中心 → 管理目录源，保存到 `config/resources.json` 的 `pluginCatalogs` | 保存并刷新目录 |
| OneBot 媒体来源、Token、测试渠道 | 工作台 → QQ 连接设置，保存到 `config/bot.json` | 按页面说明应用 |
| Provider 与其他受管服务 | 现有 Provider、资源或插件配置页 | 按各自页面的保存/重载机制应用 |
| 配置/数据根目录 | `BOT_CONFIG_DIR`、`BOT_DATA_DIR` | 启动时读取 |
| 浏览器访问的 Bot 公开基址 | `BOT_PUBLIC_ORIGIN` | 重启 Web 服务 |
| 允许访问 API 的工作台来源 | 逗号分隔的 `BOT_WEB_ORIGINS` | 重启 Bot 服务 |
| 工作台监听地址 | `WEB_HOST`、`WEB_PORT` | 重启 Web 服务 |

页面 API、`/api/events`、产物/媒体链接和 QQ 页面展示的 OneBot ws/wss 地址都使用 `BOT_PUBLIC_ORIGIN`。该地址必须是浏览器和 NapCat 各自部署环境实际可达的公开 Bot 基址，不能填写容器内部服务名作为面向浏览器的地址。API 只接受显式列出的跨域工作台来源；OneBot 握手继续使用自身鉴权，不受此项限制。不要给可在工作台编辑的设置叠加同名环境覆盖。

## 插件开发源

Bot 与 `pi-im-bot-plugins` 默认并列放置。在插件仓库根目录创建 `.env.local`，只填写需要覆盖的启动设置：

```dotenv
PLUGIN_SOURCE_PUBLIC_URL=http://plugins.example:19337
```

`plugins.example` 是说明占位，部署时换成 Bot 可达的实际地址或域名。执行：

```sh
bun --env-file=.env.local run source
```

`PLUGIN_SOURCE_PUBLIC_URL` 是插件源对外基址的唯一启动设置。未设置时默认 `http://localhost:<PLUGIN_SOURCE_PORT>`；端口默认 19337。索引、包 URL 和服务日志读取同一份解析配置。该地址保存完整 HTTP(S) 基址，可带路径前缀，不带凭据、查询参数或 fragment。变更后重启插件源。

在 Bot 的目录源设置中登记同一基址下的 `index.json`。这是两个服务各自的设置：插件源负责发布地址，Bot 负责选择读取哪个目录；运行配置不会写入 Git。Bot 位于容器或另一台机器时，localhost 指向它自身，应配置实际可达地址。

其他可选启动项见插件仓库 `.env.example`：`PLUGIN_SOURCE_PORT`、`PLUGIN_SOURCE_WATCH`、`PI_IM_BOT_SOURCE`。不引入全局 LAN_IP。默认相邻仓库布局无需填写源码根路径；已有源码目录覆盖用于支持它的工具入口。

插件构建子进程继续使用 `--no-env-file` 和最小环境，不继承本机完整 `.env.local` 或上游凭据。普通工具继续直接在可信 LAN 访问。

## 来源与分享

API 快照记录逻辑仓库 `pi-im-bot`、相对文件名与摘要；迁移清单记录来源 ID、声明版本和逐文件 SHA-256。实际磁盘根目录及操作回执保留在本机，不写进公开快照。修改 Bot 开发手册后，从插件仓库执行 `bun run docs:sync` 更新副本。

源码只通过 Git 分享，今后不以压缩包交付。分享不包含任何层级的 `AGENTS.md`、`AGENTS.override.md`、`.codex`、真实环境文件、运行配置、数据、原 `.git` 或历史暂存。两个仓库都可通过 Bot 提供的导出入口生成新目录：

```sh
bun scripts/export-source.ts . /tmp/pi-im-bot-public
bun scripts/export-source.ts ../pi-im-bot-plugins /tmp/pi-im-bot-plugins-public
```

输出目录必须尚不存在且位于输入仓库之外。导出基于 Git 文件清单，同时包含未忽略的未提交源码；发布前复查最终文件和凭据扫描结果。公开仓库从审查过的导出内容建立新历史，避免把原历史中的私人文件带出去。保留上游作者署名及 LICENSE/NOTICE。导出入口只创建目录，不生成压缩包。不要直接推送原开发仓库；分享前用密钥扫描器检查待提交文件和新历史，确认 `.gitignore` 未被 `git add -f` 绕过。
