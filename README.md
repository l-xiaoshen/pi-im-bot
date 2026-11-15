# Pi IM Bot

基于 Bun / TypeScript 和 pi.dev Pi SDK 的通用 IM Agent 宿主。支持 Mock 聊天调试、NapCat / OneBot v11 QQ 收发、网页配置 OpenAI Responses provider、HTTP MCP 和 Skill 包，以及 Shipyard 容器内的 Agent 文件和 Shell 工具。

## 启动

```sh
bun install --frozen-lockfile
bun run dev
```

`dev` 先构建工作台，再启动 Bot API 与独立前端。API 默认监听 `0.0.0.0:19335`，工作台位于 `http://localhost:3000`。局域网部署时通过 `BOT_PUBLIC_ORIGIN` 设置浏览器可访问的 Bot 基址，用逗号分隔的 `BOT_WEB_ORIGINS` 设置允许访问 API 的前端来源。配置入口和生效方式见 [部署配置](docs/configuration.md)。修改前端后运行 `bun run build` 更新静态文件；分别启动与停止服务使用 `bun run dev:bot`、`bun run dev:web`、`bun run start:bot` 和 `bun run start:web`。

当前主机也可直接使用项目内的 Bun：

```sh
./node_modules/.bin/bun run dev
```

首次启动从示例生成 `config/bot.json`、`config/providers.json`，并从已有默认设置生成 `config/framework.json`，之后不会覆盖已有配置。可用 `BOT_CONFIG_DIR`、`BOT_DATA_DIR` 指定配置与数据目录。默认数据位于项目 `data/`。

提供独立的 `services/bot/Dockerfile`、`apps/web/Dockerfile` 和双服务 `compose.yaml`，配置、Bot 数据、插件代码及插件数据分别持久保存。Compose 结构已经检查；此处不把源码或构建验证当作容器部署证明。新配置的插件执行默认关闭；已有部署以在线诊断为准。2026-11-12 部署记录已确认启用，2026-11-13 只读 `GET /api/plugins/observers` 再次返回 `enabled:true`。执行依赖与路径映射见 [部署与插件存储](docs/framework/plugin-storage.md)。本轮源码修复未部署、未变更开关。

## 先使用 Mock

1. 打开工作台，新建群聊或私聊会话。
2. 「离线演示」使用 Pi 的模拟 provider，实际经过 Pi 工具循环，展示 `chat_history` 调用。它不访问真实模型，页面中的模拟用量不代表计费。
3. 修改成员名称和 ID，可以模拟同群不同成员发言。
4. 右侧查看任务状态、provider 尝试、工具输入输出预览和 token 用量。窄屏点击「记录」查看。
5. 在「模型与 Provider」网页配置服务和模型，设为主选后，将该会话切换到「真实模型」。

Mock 与 QQ 共用任务协调、Pi 执行、工具和交付服务。Mock 是渠道适配器，离线模型只是一个明确可选的调试模式；真实请求失败不会静默切换为演示回复。

## Bot 设置与共享对话

「Bot 设置」管理人格、回复偏好、消息投影、行为和工具权限，支持默认 → 账号 → 聊天范围 → 当前对话四层覆盖。取消“在此设置”即可恢复继承，空字符串和空工具集合是明确的覆盖值。页面可查看最终生效值及来源。人格与配置在任务受理时固定版本；权限规则在实际调用前再校验。

平台账号下面有渠道（群/私聊），每个渠道再拥有一个或多个会话上下文。群成员共享该渠道当前会话的人格和上下文；聊天工具栏只切换会话，不改变渠道身份或 QQ 测试目标。切换会话会停止当前渠道任务，聊天记录和容器工作区保留。模拟成员 ID 不会变成 QQ 权限身份。详细实现与后续阶段见 [阶段交付记录](docs/framework/implementation.md)。

## MCP、Skill 与工具收纳

「MCP 与 Skill」可登记 HTTP MCP 服务、配置 Headers、启停并刷新工具目录；凭据占位和留空 URL 会保留原值。配置保存到 `config/resources.json`。当前支持 Streamable HTTP；工具调用有独立期限，失败不会自动重放。

服务声明 MCP Tasks 后，要求 Tasks 的工具自动转为持久后台 Job；支持可选 Tasks 的工具默认保持短调用，也可用 `start_job` 明确转后台。在 MCP 编辑页可调整自动策略、轮询间隔、此服务等待任务上限和查询失败上限。已提交任务恢复时查询原远端 ID，未知提交不会重新创建。未知取消可在后台任务页显式核对；核对不会重复发送聊天消息。详见 [外部任务与 Cron](docs/framework/external-tasks.md)。

Skill 使用根部含 `SKILL.md` 的本地目录，在网页登记后点击「导入 / 更新快照」。导入保存固定版本，Agent 按需加载说明和文件；已配置 Shipyard 时，包映射到容器 `/workspace/.bot-skills/`，脚本使用现有远程 Shell。导入本身不执行包内代码。`/skills` 查看当前可用包，`/skill ID 内容` 显式提供一个包给本轮 Agent。

「Bot 设置 → 能力与权限」可分别选择 MCP 和 Skill，并在全量装载与 Pi 按需搜索之间单选。按需模式提供 `tool_search`，只保持配置的常驻工具和近期使用工具；Skill 说明也按需获取。权限默认拒绝时，需要显式允许 `tool_search` 才能搜索。

工具选择与权限使用稳定 ID：内置工具使用原名，MCP 使用 `mcp:服务ID/工具名`，Skill 使用 `skill:ID`。与模型使用的工具别名分开。MCP 大段输出保存为本会话产物，用 `artifact_read` 按 ID 分页读取，减少长结果重复占用上下文。

## 图片、附件与引用

Mock 聊天可上传附件并引用已有消息。QQ 接收数组和 CQ 字符串中的图片、媒体与回复 ID；在启用的测试群中使用 `!pi 内容` 或 `@Bot 内容` 触发，普通消息只同步记录。图片按需下载并在当前范围缓存；浏览器查看会载入可见图片。

图片通过 Pi 的请求钩子临时提供给本轮主模型，默认最多 4 张、最长边 1536 像素、4 MiB Base64 总量。历史保存引用，下一轮文字请求不重复携带图片；无需额外的图片描述模型。预算与引用开关可在「Bot 设置 → 媒体与引用」调整。`media_read` 可按 ID 重看，`stage=true` 在另有 `write` 权限时传入当前沙盒。

引用优先使用当前范围记录，QQ 的缺失引用尝试向平台查询，并验证群/私聊归属。已撤回来源停止自动投影。媒体 URL、下载签名和宿主路径不提供给模型。非标准 QQ 媒体来源可在连接设置中登记 origin。当前支持图片视觉输入；音频、视频、文件保留为可下载附件，语音识别和视频处理由后续能力接入。详见 [媒体与引用实现](docs/framework/media.md)。

## 插件操作

作者文档见 [插件开发手册](docs/plugins/README.md)，涵盖 Bot RPC、配置、触发、指令路由、Hook、后台任务、持久数据和发布。独立迁移工作区位于 `../pi-im-bot-plugins`，首个状态查询插件提供 PNG 卡片、文本和 JSON。

本地开发源的启动环境与 Bot 目录登记见 [部署配置](docs/configuration.md#插件开发源)。工作区执行 `bun run source` 后自动检测源码并发布固定摘要的开发包；插件中心刷新目录后手动安装/更新，实例配置保留。设计与使用见 [本地插件开发源](../pi-im-bot-plugins/docs/local-plugin-source.md)。

「插件中心」提供已安装、发现插件和运行诊断。可以从静态目录、GitHub Release/ZIP 链接、上传包或开发目录安装，使用 AstrBot 风格 `_conf_schema.json` 自动生成配置表单。详情管理实例/账号/群/会话配置、能力授权、服务依赖、范围与优先级，以及版本和文档。一个 operation 可同时作为 Pi 工具和 QQ/Mock 直接指令，后台操作继续复用 Job。

核心上下文、文字变换、呈现选择和持久回执观察已接入，可按群配置顺序与优先级；延后撤回由核心任务保存和执行。详见 [共享切入点与持久观察](docs/framework/plugin-pipeline.md)。插件自定义切入点、固定容量持久卷、大文件流式发布和统一产物额度也已实现，四个授权临时容器通过实际验收并清理，见 [插件数据与产物额度](docs/framework/plugin-storage.md)。网页支持登记、导入、配置和诊断；执行状态动态读取，安装成功不等于实例在当前范围可执行。

首批管理功能与实际边界见 [插件中心实现](docs/framework/plugin-management.md)。秘密值单独保留，版本固定到内容摘要；下载发布 ZIP 不包含实例设置或数据。可用 `bun run pack:plugin examples/plugins/echo /tmp/echo.zip` 打包。`bun run preview:plugins` 的 19336 端口仍保留早期浏览器示例，不是正式管理入口。

GitHub 链接支持仓库、`.git`、分支/标签、commit、具体插件目录和 Release 页面。没有 Release 也可从源码安装，先固定到 commit；仓库需含 `plugin.json` 和已声明的 JS/TS 入口及依赖。安装时不执行入口或宿主构建脚本。

## Provider 配置

网页沿用 AstrBot 的服务与模型分层交互：左侧选择提供商，右侧管理连接和模型。当前协议固定为 `openai-responses`，通过 Pi 的原生 Responses 适配器发送 HTTP SSE 请求。

1. 点击「新增提供商」，填写名称、API 基址及 API Key，也可选择环境变量或自定义 Header 认证。
2. 点击「保存并获取模型」，搜索并批量添加模型；服务不提供 `/models` 时可以手动添加。
3. 在模型行点击「配置」，调整上下文窗口、输出上限、推理与图片能力，以及 `reasoning.effort`、`service_tier`、自定义 Headers/Body。
4. 「测试」会向该模型发送一条简短 Responses 请求，最多 256 输出 token、最长 30 秒，不经过候选组故障转移。测试会产生少量上游用量；表单中的测试使用尚未保存的参数。
5. 点击模型的「设为主选」将其放到默认组第一位。在「候选组」页可以新增组、调整顺序、设置冷却时间和默认组。

提供商和模型可以分别启停。保存后立即对新任务生效，在途任务继续使用原配置。已有密钥不会回显；API Key 留空表示保留，明确勾选清除或选择无 API Key 才会移除。敏感 Header/Body 字段以占位显示，保留占位会保留原值。

服务和模型改名会同步候选组引用，删除会移除相应候选。候选组可以暂时为空；正在被 Bot 设置或对话引用的组不能删除。Bot 的默认模型组在「Bot 设置」选择，聊天工具栏的模型组选择覆盖当前对话。

配置仍保存在 **`config/providers.json`**，可以手动编辑。网页写入带版本检查并原子替换文件；发现其他页面或文件修改后会拒绝覆盖，保留当前表单输入。配置格式如下：

```json
{
  "defaultGroup": "main",
  "providers": [
    {
      "id": "gateway-a",
      "enabled": true,
      "protocol": "openai-responses",
      "baseUrl": "https://your-gateway.example/v1",
      "apiKey": "填写上游凭据",
      "headers": {
        "X-Client-Name": "pi-im-bot"
      },
      "body": {
        "store": false,
        "service_tier": "auto"
      },
      "timeoutMs": 120000,
      "models": [
        {
          "id": "your-primary-model",
          "contextWindow": 128000,
          "maxOutputTokens": 16384,
          "reasoning": true,
          "images": true,
          "headers": {},
          "body": {
            "reasoning": { "effort": "medium" }
          }
        },
        {
          "id": "your-secondary-model",
          "contextWindow": 128000,
          "maxOutputTokens": 8192,
          "body": {
            "reasoning": { "effort": "low" },
            "service_tier": "priority"
          }
        }
      ]
    }
  ],
  "groups": [
    {
      "id": "main",
      "name": "主模型组",
      "candidates": [
        { "provider": "gateway-a", "model": "your-primary-model" },
        { "provider": "gateway-a", "model": "your-secondary-model" }
      ],
      "cooldownMs": 60000
    }
  ]
}
```

`baseUrl` 是 API 基址，通常以 `/v1` 结尾，不要包含最后的 `/responses`。`id` 必须填写服务实际接受的模型 ID。`contextWindow`、`maxOutputTokens` 是 Pi 使用的模型元数据，应按实际模型填写；`reasoning` 表示模型能力，具体请求的推理强度由 `body.reasoning.effort` 设置。

Provider 与模型都支持 `headers` 和 `body`：

- Headers 按名称忽略大小写合并，模型值覆盖 provider 值。`null` 表示删除该默认 header。自定义 `Authorization` 同样支持；没有 API key 时不自动添加 Bearer 凭据。
- Body 嵌套对象递归合并，数组整体替换，`null` 原样发送。模型设置优先于 provider 设置。
- `model`、`input`、`tools`、`stream`、`previous_response_id`、`conversation` 由运行时维护，不接受配置覆盖。
- 支持自定义供应商附加字段。`reasoning.effort`、`service_tier` 等字段的可用值由目标模型和服务决定，框架不静默改写或降级这些值。
- 可用 `apiKeyEnv` 替代 `apiKey`，指向环境变量；配置了 `apiKeyEnv` 时它优先，变量不存在会使配置校验失败。Bun 启动时读取项目 `.env`，修改 `.env` 后需要重启；直接修改 `providers.json` 中的凭据可以热重载。

配置文件和 `.env` 已忽略版本控制。状态和事件接口只返回配置元数据；编辑接口返回可编辑字段，API Key 不回传，识别为凭据的 Header/Body 字段用占位保留。

手动编辑文件后，点击工作台「模型与 Provider → 从文件重载」。网页保存无需再重载。重载先完整校验再切换，监听地址和端口需要重启服务。「已配置」或启用状态不代表已经验证上游连接，可以使用模型的「测试」按钮验证。

### Fallback / failback

每次模型请求按组中的候选顺序尝试，每个候选最多一次。Pi / HTTP 适配器的额外自动重试关闭，避免叠加重试预算。

- HTTP 错误、连接错误、流中断和 provider 截止时间到期会尝试下一候选。
- 失败尝试的正文和工具调用只作为临时预览，不提交给 Pi。只有成功的完整响应进入 Pi 工具循环，因此切换不会重放已经完成的工具。
- 同一任务优先继续使用已经成功的候选；新任务在冷却结束后重新优先选择首选项，不发额外探活模型请求。
- 所有候选都在冷却时，只探测最早到期的一项。
- 用户取消会立即结束，不再尝试备用 provider。
- 工具错误不会触发整个 Agent 任务重跑。平台发送超时也不会自动重发。

真实模型的 token 用量取自 provider 经 Pi 规范化后的 usage；输入包含普通输入和缓存输入，输出不重复叠加 reasoning token。兼容服务未返回 usage 时，无法完整统计其消耗。当前没有配置模型价格，工作台不展示估算费用。

## Pi 能力与工作区

提供下列限定到当前聊天范围的 Bot 能力，按生效配置与触发权限装载：

- `chat_history`：按需读取当前 IM 会话记录。
- `chat_send`：向当前会话发送明确的额外通知，返回交付回执。
- `schedule_create`、`schedule_list`、`schedule_delete`：管理当前会话的计划任务。

普通最终回复由交付服务发送，工具不必再次调用 `chat_send`。模型文字与平台呈现保持分离，为后续 TTS、媒体和撤回策略预留位置。

运行底座为锁定版本的 `@earendil-works/pi-durable@1.5.0`，对话、工具执行记录与后台任务保存在 `data/agent.sqlite`。旧 `data/pi-sessions/` 保留，首次使用对应会话时通过 Pi 公共接口导入，原先的宿主工具声明不会恢复。

同群主对话保持一个活动推理，后台任务使用独立子对话；模型请求按前台 1 + 后台 1 调度。短时间多人的发言可合批，仍保留各自来源与顺序，工具权限取交集。窗口默认安静 600 ms、最长 2 秒、最多 6 条；配置变化另起批次，控制指令直接处理，超过队列期限的旧请求不会集中补发。

网页「后台任务」可以创建、修订、停止任务和下载结果。`delegate_task` 委派多步 Agent 工作，`start_job` 启动单次 MCP 或沙盒 Shell 操作；完成后直接交付结果并向主对话提供精简事实，无需额外模型调用。子 Agent 不递归委派 Agent，也不直接管理群发送和计划。`job_list/status/cancel/update` 管理当前群的共享任务，`job_wait` 仅供后台 Agent 等待自己创建的子操作。其他获准成员可以修订任务，新版本按本次触发者的权限运行，旧版本不再交付迟到结果。

后台任务与每个修订使用独立沙盒/Cargo，停止它不会回收主对话的容器。每轮创建数量、会话未收尾数量和期限可在「Bot 设置」调整；全局未收尾上限为 `bot.json` 的 `agent.maxOutstandingJobs`，默认 128。模型请求并发上限与任务积压上限分别控制。

`data/workspaces/` 只是宿主侧会话元数据目录，不向模型开放文件访问。当前支持复用现有 Shipyard/Bay：Pi 原生 `read/write/edit/ls/bash` 都通过公开操作接口在远程容器中执行，不调用宿主文件或 Shell 后端。绝对路径、`~`、符号链接都指向容器；容器内不额外限制路径和命令，现有容器用户权限仍由 Shipyard 决定。

在 `config/bot.json` 中配置：

~~~json
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
~~~

也可用 `apiKey` 字段保存 Bay 凭据，配置文件已忽略版本控制；凭据不传入容器或网页。使用现有含 Node.js 的 Ship 镜像，文件操作辅助代码在容器内执行。Bot 在 Docker 中部署时，endpoint 使用容器可达的 Bay 地址，不使用容器自身的 127.0.0.1，也不需要挂载 Docker socket。

每个会话第一次使用工具时建立专用 sandbox/Cargo，绑定记录保存在 `data/shipyard-workspaces/`。跨轮、Bot 重启和 /new 继续使用该工作区。默认目录 `/workspace` 持久化；容器 /tmp、系统目录等位置随容器回收可能丢失。已有宿主工作区文件保留原位，不自动搬入容器。

取消任务或远程执行结果不确定时，先中断专用容器内执行用户的进程，再调用 Bay stop 回收计算，保留 Cargo。仅调用 stop 会遇到 Bay 的容器退出宽限期，因此不能只断开 HTTP 请求。下次工具操作重新启动计算；普通完成交给 Bay 现有空闲回收策略。大段 Shell 输出保存到容器 `/workspace/.pi-output/`，不写 Pi 的宿主输出临时文件。Bay 当前 Shell API 非流式，工具输出在命令完成后返回；传输上限不等于容器磁盘配额。

没有配置后端时默认 `disabled`，保留聊天、计划任务、已配置的 HTTP MCP 和 Skill 说明读取。后端故障不回退到宿主执行；旧会话不能恢复宿主工具。工作区/全局扩展、Skill/MCP 自动发现与 Codemode 入口仍关闭，只加载网页明确登记的资源。创建结果不明确、绑定丢失或配置 endpoint/profile 与已有绑定冲突时明确报错，不静默换成空工作区。不要删除绑定文件作为常规“修复”；应先核对 Bay 中的 sandbox/Cargo。

当前执行复用现有容器边界，不改造 Bay 的网络/运行时策略。[Bot 框架设计](docs/framework/README.md) 按实际启用配置和近期使用分为数据加工、偏好、行为、内置基建与扩展资源；共享会话与设置基础已实现，后续能力按阶段推进。早期 [隔离调研](docs/isolation-and-plugins.md) 保留为参考。

真实会话使用 Pi 自动压缩，近期保留预算为 8000 token；缓存预热初始关闭。每轮模型请求次数和执行时间在「Bot 设置」配置，全局并发数在 `bot.json` 配置。

## 指令与计划任务

Mock 中可以直接输入：

- `/help`、`/status`：宿主处理，不调用模型。
- `/stop`：取消当前会话的在途和排队任务。
- `/new`：开启新的 Pi 会话，保留 IM 记录和工作区文件。
- `/jobs`、`/job ID`：查看共享后台任务及其结果，ID 可使用唯一的前 8 位。
- `/job cancel ID`：停止指定任务。
- `/job update ID 版本号 补充说明`：修订 Agent 任务，版本过期会拒绝覆盖。

计划任务支持 Cron 和 IANA 时区，默认 `Asia/Shanghai`，可从界面或 Pi 工具创建。每次受理进入 Job 体系并固定触发时间、时区、创建者身份和能力上限。默认新建独立上下文，按计划保留持久工作区；也可选择共享主对话。计划及其未完成的孩子不会与下一次重叠，这一状态跨重启保留；未受理的错过触发仍跳过。网页可分别暂停未来自动执行、停止本次工作和删除计划。旧计划若未保存来源，自动执行暂停，可明确重新授权。

当前会话、消息、任务、轨迹、交付账本和计划保存在 `data/bot.sqlite`，Pi 的持久执行保存在 `data/agent.sqlite`。`runtime-owner.sqlite` 防止多个进程同时写入同一数据目录。每次执行的私有配置归档位于 `data/configuration-snapshots/`，可能包含上游凭据，网页只返回引用摘要；备份时须与其他数据一同保存并保护。

重启会恢复已受理的 durable 任务及其固定配置，已完成工具不会重放。单次外部操作如果尚未得到回执，则标为 `outcome_unknown`，不自动重新提交；已知交付复用原回执，未知交付保留待人工核对。旧 coding-agent 的中断任务不自动重放。标准 MCP Tasks 与 Cron 已接入持久生命周期，其他业务异步协议继续由后续驱动接入。

`artifact_publish` 从当前容器读取并保存生成文件，返回会话内产物 ID。主对话可用 `chat_send` 的 `artifactIds` 发送，后台 Agent 的产物随结果交付。HTTP MCP 返回的图片、音频及内嵌二进制也会登记为产物；外部资源链接仅保留引用，不自动抓取任意 URL。网页可显示图片、播放音频/视频并下载文件；QQ 目前直接发送图片和音频，其他附件或超过单次 20 MiB 交付预算的文件在网页下载。产物保存在 `data/artifacts/`，不会向模型提供宿主路径。

一个逻辑回复可有多条平台回执，发送账本逐条保存 ID；QQ 自身回报会合并为同一条网页消息。部分发送失败不会自动重发，已知消息 ID 仍可撤回。模型原文、产物与平台呈现分别记录。

## QQ / NapCat 接入

在 NapCat 新增反向 WebSocket 客户端：

```text
ws://bot.example:19335/onebot/v11/ws
```

消息格式建议 Array，NapCat 会发送 `X-Self-ID` 握手头。已有 AstrBot 连接可以继续保留。

「QQ 接入 → 配置连接」可设置可选 Access Token、启停接入和 Agent 消息前缀。Token 必须与 NapCat 该反向 WS 客户端的 Token 一致；服务验证 Authorization Bearer，也兼容 access_token 查询参数。网页不回显 Token；留空保留原值，勾选清除才删除。修改 Token 会关闭现有 QQ 连接，由 NapCat 按新配置重连，不需要重启 Bot。

「测试群」支持新增、启用、停用和更换，目标按 **机器人 QQ 号 + 群号** 绑定。可从已发现会话选择、刷新 QQ 群列表，或手工填写。讨论组标识可通过发送一条消息自动发现。更换群时停用旧目标，停止其排队和在途任务；之后不再提交向旧群发送的新消息。旧会话历史保留，重新启用复用原会话。

已启用测试群的所有新消息都会实时同步到聊天窗口，保留原文、发言人、时间与消息 ID。**普通消息仅记录，不触发模型。** 内置指令可直接在 QQ 发送，Agent 请求使用配置的前缀：

```text
!pi 你好
/help
/status
/stop
/new
```

自身账号的发送回报只同步、去重，不触发 Agent。未启用的群只用于发现标识，不记录正文。页面显示连接状态、最近认证失败、最后收到消息时间和路由结果，可区分“仅记录”“未启用测试目标”“自身消息”等情况。

设置原子保存到 `config/bot.json` 的 `onebot` 部分并立即生效；修改不会覆盖 Provider 或沙盒设置。并发修改或旧页面保存会被版本检查拒绝。刷新和重启后配置仍保留。QQ 支持文字、入站图片/引用、撤回通知，以及图片/音频产物交付。

## 开发检查

```sh
bun run check
bun test tests
bun run build
bun run format:check
```

协议测试会启动仅监听 loopback 的临时 Responses 服务，不调用真实模型。覆盖 headers/body 合并、失败流丢弃、工具执行后的故障转移、主动取消、超时和冷却回切。OneBot 回归使用内存状态，覆盖账号与群匹配、普通消息同步、直接 /help、自身回报去重、停用目标的发送拦截、Token 握手与配置冲突。执行边界测试覆盖旧会话恢复、关闭扩展自动发现，以及文件和 Shell 委派至沙盒。未添加数据库测试。

UI 使用维护中的共享浏览器验证，详见上级工作区的浏览器约定。

## 模块边界

插件包、Worker RPC、工具/指令、Job、共享核心与插件自定义切入点、存储额度已接入，见 [阶段交付记录](docs/framework/implementation.md)。真实容器验收记录与当前部署状态分别保存；领域插件迁移、Telegram 和知识库继续按阶段完善。本轮可靠性、取消与历史性能修复及尚缺能力见 [审核修复报告](docs/framework/review-remediation-2026-11-12.md)。

```text
apps/web/             独立构建与部署的浏览器工作台
services/bot/         Bot 组合入口、HTTP API 与 WebSocket 端点
pkgs/contracts/src/  跨端共享的 schema、DTO 与事件
pkgs/support/src/    通用异步与安全路径工具
pkgs/channels/src/    渠道协议与回执
pkgs/providers/src/   配置、候选组、Responses 请求与故障转移
pkgs/agent/src/       Pi 会话装配与宿主能力
pkgs/jobs/src/        持久后台任务、修订、取消和结果回流
pkgs/conversations/src/ 稳定聊天范围与当前对话管理、历史映射迁移
pkgs/settings/src/    人格、配置继承、生效来源与版本编辑
pkgs/permissions/src/ 触发身份、授权上限与调用时校验
pkgs/messages/src/   模型输入、历史和平台输出投影
pkgs/media/src/      私有媒体引用、按需缓存、图片预算和本轮视觉投影
pkgs/capabilities/src/ Pi 原生工具搜索与单一收纳策略
pkgs/resources/src/  MCP、Skill 注册、固定版本、连接与装载
pkgs/plugins/src/    插件包、Web 编辑、Worker RPC、操作/指令、后台 Job 与变换执行器
pkgs/plugin-sdk/src/ 插件作者公开入口与受管 Worker 入口
pkgs/artifacts/src/  范围内工具产物存储和分页读取
pkgs/runtime/src/     统一任务入口、并发、事件和交付
pkgs/scheduler/src/   持久计划与时间触发
pkgs/storage/src/     宿主状态；Pi 对话仍由 Pi 管理
services/bot/src/http/        工作台 API
apps/web/src/            Mock 聊天与调试界面
```

参考资料：

- [OpenAI Responses](https://developers.openai.com/api/reference/resources/responses/methods/create)、[Reasoning](https://developers.openai.com/api/docs/guides/reasoning)、[Streaming](https://developers.openai.com/api/docs/guides/streaming-responses)
- [OpenAI 模型列表](https://developers.openai.com/api/reference/resources/models/methods/list)
- [Pi SDK v1.5.0](https://github.com/earendil-works/pi/blob/v1.5.0/packages/coding-agent/docs/sdk.md)
- [AstrBot OneBot 反向 WebSocket 接入](https://github.com/AstrBotDevs/AstrBot/blob/v4.28.0/astrbot/core/platform/sources/aiocqhttp/aiocqhttp_platform_adapter.py)

## Git 分享

源码仅通过 Git 仓库分享，不以压缩包交付。请从审核后的源码建立新历史；所有层级的 `.codex`、`AGENTS.md`、`AGENTS.override.md`、本地环境文件、真实配置、运行数据和私有审阅记录不得提交。启动配置集中见 [部署配置](docs/configuration.md)。
