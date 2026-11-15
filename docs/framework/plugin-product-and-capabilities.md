# 插件管理、编排与开发能力核查

核查开始于 2026-11-10，交付更新于 2026-11-11。参考 [AstrBot c6b2c65b](https://github.com/AstrBotDevs/AstrBot/tree/c6b2c65b048f5a1a33c4f388040e57e4e7d6401a)（v4.26.1 后一个提交）与 [Koishi 97d5c395](https://github.com/koishijs/koishi/tree/97d5c395750cec37b772e0b94dc63c427e3bb868)。本机 AstrBot 部署镜像是 4.28.0；比较以明确读到的源码为依据，不把分析 checkout 当作部署中的精确源码。

## 管理入口

插件实例是一份代码、配置与数据；账号、群、conversation 是使用这个实例的聊天范围，不是同一维度，不能混在一个“正在配置”选择器里。

- 已安装列表：名称、版本、启用开关、实际阻塞状态、配置、使用方法、强制更新、删除。
- 配置：只编辑当前插件的 schema 字段。名称、主题、概率等业务偏好不是 Docker、RPC 或宿主服务配置。
- 使用方法：声明的指令/工具与安全渲染的 README。
- 运行环境：独立的全局入口；检查 Docker API/本地镜像、FUSE 设备和文件系统工具，保存后应用，无需手改 JSON 或重启。不自动拉镜像或安装系统包。
- 宿主能力：从声明生成；启用时带入所需 grant。既有实例缺失时显示具体服务和“允许所需能力”，不再要求寻找独立复选框。
- 自定义页面：本次未实现，不显示空入口。后续需要隔离页面和显式 RPC，不把插件 JS 导入工作台主页面。
- 编排：全局入口展示真实节点；只有声明了 Hook 的插件才有实例编排页。纯指令/工具插件不显示无行为的流程选项。

现有群/会话覆盖数据保留，仍由原运行时解析；实例编辑器不再枚举这些维度。多实例快捷创建、结构化服务绑定管理仍需后续完善。

## 代码节点与流转契约

`pkgs/plugins/src/hooks/points.ts` 声明节点标志、执行位置、模式、输入/输出 Zod schema 和可修改字段。上下文、呈现、消息/回执记录的实际调用引用这些标志和 schema；`GET /api/plugins/pipeline` 从同一声明生成节点及 JSON Schema，UI 没有另一份手写节点列表。

| 切入点 | 执行位置 | 输入 → 输出 | 组合规则 |
| --- | --- | --- | --- |
| message.recorded@1 | 消息记录后 | `{message: ChatMessage}` → 返回值忽略 | 持久异步观察，不修改已记录消息 |
| context.collect@1 | Pi 执行前 | `{text}` → `{fragments:[{key,text}]}` | 并行、有来源、去重、统一预算 |
| delivery.visibility@1 | 发送处理前 | DeliveryView → `{allow,reason?}` | 拒绝不能被后面的允许覆盖 |
| delivery.text@1 | 媒体呈现前 | DeliveryView → `{baseRevision,patch}` | 顺序应用，仅 `/text` 可写，失败整份拒绝 |
| delivery.presentation@1 | 文字处理后、平台发送前 | DeliveryView → `{text,artifactIds}` 或 null | 首个有效呈现器获选，适合 TTS |
| delivery.receipt@1 | 发送账本确认后 | 阶段、状态、原文/呈现文、产物/平台回执 ID → 返回值忽略 | 持久异步观察，例如安排本次已确认消息撤回 |

DeliveryView 包含逻辑消息 ID、roomId、conversationId、地址、来源、回复阶段、文字与 artifactIds。文件先发布为 Artifact，再传 ID；不把宿主路径或大块二进制作为下游发送契约。呈现结果的产物会按聊天范围重新校验。

全局编排保存处理器启停与优先级，带版本检查；依赖和 before/after 拓扑关系先于优先级。未知处理器不能在 UI 中凭空添加。作者在 manifest 声明自己实现的 handler 与目标 point，UI 控制已实现、契约相容的处理器。

当前没有模型请求前后、工具调用前后、入站消息变换等公开节点，六个切入点不等于完整 Agent 流水线。增加这些点需要在真实执行位置定义契约、权限、重试/取消语义并接入，之后才在 UI 展示。Pi 继续管理模型循环与工具副作用。

## 与竞品逐项比较

| 能力 | AstrBot 参考源码 | Koishi 参考源码 | 本框架插件实际可用 |
| --- | --- | --- | --- |
| 配置 | `_conf_schema.json`、插件配置页 | Schema、Console | 同风格表单，服务端校验、秘密保留、默认值和覆盖 |
| 指令/路由 | command/group/filter | command/parser/session.execute | manifest command + parser → 同一个 operation，保留核心别名和独立鉴权 |
| LLM 工具 | 工具注册/管理 | 相应模型插件提供 | operation.tool 注册 Pi 工具，可按需装载 |
| 调用数据 | AstrMessageEvent、消息对象、会话身份 | Session/event/user/channel | scope/address、conversation、actors、origin、settings、deadline、grants；规范化消息，不提供裸 adapter |
| 历史/会话 | conversation_manager 等 | Session、数据库 | history.read 提供本聊天投影；不开放任意 Pi 会话修改 |
| 入站媒体 | 事件消息链/文件引用与平台能力 | 消息元素、Session/HTTP 服务 | **缺失**插件按 mediaId 读取原始媒体的接口；当前消息里是附件描述/引用，artifact.read 只读取已发布产物 |
| 消息元素/交互 | mention、引用、合并转发及平台扩展 | h/消息元素、交互插件 | 当前为文字与 Artifact；**缺失**结构化 @、引用/转发构造及交互回调接口 |
| 模型/人格 | provider 列表、llm_generate、using provider | 外部模型插件/注入服务 | Bot 的人格和模型可运行；插件没有直接生成或 Provider 枚举 RPC |
| TTS/STT/embedding | Provider 管理器 | 外部服务插件 | **缺失**插件可调用的语音/embedding 接口 |
| 外部 HTTP | 插件可用 HTTP 库 | ctx.http | Worker 无网络；可调用绑定 MCP；**缺失**通用受管 HTTP 连接器 |
| 发送/文件 | MessageChain、send_message、事件 send | Session.send、消息元素、Bot API | delivery.send、artifact.read/write/publish，受聊天范围和发送账本约束 |
| 撤回 | 平台调用/事件 | Bot API/消息服务 | delivery.recall：本次已确认回执的延后动作，无任意跨群撤回 |
| 异步 | register_task、插件自定义实现 | ctx 生命周期、定时/插件服务 | pending/poll/cancel 接入持久 Job；插件不能直接启动子 Agent |
| Cron | scheduler 或插件任务 | 定时服务、相关插件 | Bot Cron 已实现；**缺失**插件管理计划的 RPC |
| 持久数据 | 插件数据路径/KV/数据库 | Minato 数据库/模型 | 按实例/聊天范围隔离的限额私有卷；没有命名空间 KV/SQL |
| Web/自定义页 | register_web_api、插件 pages | Console 扩展 | **缺失**插件页面、受管路由、交互回调 |
| 渲染/知识库 | HTML/T2I、相关管理器 | 浏览器/检索服务插件 | 状态插件自带 WASM；没有通用 HTML 渲染或知识库 RPC |
| 依赖/生命周期 | Star manager | Cordis inject/effect/dispose | 固定代码、独立 Worker、grant、连接器和插件依赖；没有公开 init/dispose/数据迁移 API |
| 错误影响 | 通常共享主进程空间 | 服务作用域与资源释放，通常同进程 | 独立容器、RPC 超时/取消、隔离数据、定向熔断；这不代表上列缺口已实现 |

依据：AstrBot `core/star/context.py`、`core/star/base.py`、`dashboard/src/views/extension/InstalledPluginsTab.vue`、`PluginDetailPage.vue`；Koishi `packages/core/src/context.ts`、`middleware.ts`、`session.ts`、`database.ts`；本项目 `plugins/host.ts`、`rpc/protocol.ts`、`sdk/index.ts`、`commands.ts`、`jobs/runner.ts`、`hooks/`。

## 下一批必须补齐的接口

1. 受管 HTTP 与模型/语音连接器：配置基址、秘密 Header、期限、大小与响应类型，Worker 获取命名服务而不是凭据。这是现用 TTS、搜索、视频插件迁移的关键前置。
2. 入站媒体读取、结构化消息元素、插件 Cron、更多事件订阅与交互回调，复用现有任务、触发身份、取消与幂等账本。
3. 插件页面/路由、渲染、知识库和必要 KV，逐项提供接口与领域插件验收，不放空方法或无行为开关。

这些后续项仍未完成。插件能力参考列出的 RPC 才可调用；Bot 内部有同名能力不代表插件已经接入。
