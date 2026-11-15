# Pi IM Bot 分层与插件编排独立复审

日期：2026-11-13。审查者：WSL 主会话 Codex。实施者：NAS 本机 Codex 会话 （内部会话标识保留在本机）。本报告由委托审核者独立形成；具体修复、回归、性能测量与提交记录见 [修复记录](review-remediation-2026-11-12.md)。本报告中的建议尚未实现，不能作为可调用 API 文档。

## 总体判断

三层职责方向成立：Pi 管模型循环、会话和压缩；Bot 管可信输入、权限、持久任务、执行资源、产物及交付；插件管领域业务。Worker 隔离、固定代码版本、显式 RPC、按范围授权和发送账本都应保留。后续可以继续采用单个 Bun 宿主配合隔离 Worker 的部署方式。

当前的主要阻塞是：Bot 内部已有的媒体、任务、模型、计划等能力，只有一部分成为插件可使用的稳定契约；插件 manifest 又缺少足够的执行语义。编排 UI 可以调整已存在处理器的顺序，但无法补出缺失的服务、触发位置、恢复协议和数据依赖。

## Bot 层需要补齐的服务

| 优先级 | 需要的能力 | 目前已有的部分 | 对真实插件的影响及契约要求 |
| --- | --- | --- | --- |
| 第一批 | 具名 HTTP、语音及其他领域服务连接器 | 插件可调用绑定 MCP，connections 类型为 mcp/plugin；Worker 无网络 | TTS 音色列表、合成、视频和搜索接口需要可调用服务。Bot 代管凭据、期限、取消、体积限制、重定向和任务回执；插件得到服务引用与业务结果。先将已有服务封装成 MCP 也可满足具体迁移。 |
| 第一批 | 本范围入站媒体读取与转换为 Artifact | 模型工具有 media_read；插件能读已发布 Artifact，消息里有附件引用 | 收到的图片/音视频不能仅靠 artifact.read 取得。需要基于 mediaId、来源范围和授权读取，返回有界内容或 Artifact，并保留撤回、过期和来源不可用语义。 |
| 第一批 | 插件拥有的 Job 提交与观察事件到 operation 的持久触发 | 前后台 operation、pending/poll/cancel 和核心 Job 已实现 | message.recorded 只是持久观察；观察服务本身不能直接群发，也没有统一提交 Job 的 RPC。被动监测、订阅和长处理需要把事件受理为具名 operation/Job，继承来源权限和期限，明确谁交付最终结果。 |
| 第二批 | 具备所有权的计划、外部订阅和持久交互 | Bot Cron、回执观察及延后撤回已有实现 | 月流量采样、视频订阅和用户确认需要插件实例/版本拥有的触发项、幂等键、停用/升级处理、范围授权和恢复规则。Worker import 和进程存活期不能承担这些生命周期。 |
| 第二批 | 按用途绑定的模型/视觉、TTS/STT、embedding 服务 | Pi 模型网关及资源选择器已有实现 | 一次性领域推理、语音和检索需要独立的用途、服务别名、预算及用量归属。Pi 继续承担 Agent 循环；Bot 负责服务执行和凭据。 |
| 第二批 | 结构化消息与受权目标、交互回调 | 当前发送文字和 Artifact，可限定范围发送及撤回 | @、引用、合并转发、群文件、按钮和跨范围提醒需要类型化消息元素、平台能力判断、目标授权及分部回执。不能仅向业务插件传一个 adapter 对象。 |
| 按实际迁移补充 | 增量历史、渲染、知识库、配置资源上传及隔离页面 | history.read 提供最近有界投影；状态插件自带 WASM 渲染 | 分析群流水需要游标及完整性说明；背景图、HTML 卡片、RAG 或确认页面各需明确服务接口。按具体插件验收补齐，避免先做完整通用平台。 |

依据：[宿主 RPC](../../pkgs/plugins/src/host.ts)、[连接器](../../pkgs/plugins/src/connectors.ts)、[观察执行](../../pkgs/plugins/src/observations/worker.ts)、[公共 SDK](../../pkgs/plugin-sdk/src/index.ts)、[操作与 Hook 声明](../../pkgs/plugins/src/manifest.ts)。Bot 内部有同名工具不等于插件已经取得对应 RPC。

## Plugin 层需要补齐的执行和组合声明

| 契约缺口 | 当前能力 | 缺口如何影响编排 |
| --- | --- | --- |
| 副作用、幂等、重放、结果核对与共享资源所有权 | operation 有输入/可选输出 schema、grants、前后台、timeout、poll/cancel；后台运行已有持久协议 | Core 无法仅凭 handler 名判断提交、轮询和取消能否重放，也无法判断两个操作是否争用同一资源。需要经 Bot 接纳的执行策略、稳定操作标识、恢复句柄及资源租约声明。 |
| pending handle、poll/cancel 的独立输入输出契约 | 当前通用 outcome 已存在，execute 输入和完成输出确实会校验 | 跨插件调用只能由作者自行理解 handle 结构与取消结果。显式 schema、终态和未知结果语义才能支持可靠组合；不能把已有 schema 校验误报为完全缺失。 |
| 实例与数据生命周期、迁移及排空 | 固定 generation、私有数据卷、Worker 取消和回收已实现 | 插件实例、代码版本、数据版本和 Worker 生命周期不同。需要受管的准备、迁移、激活、排空、销毁与回滚声明，才能在升级时保留旧任务的必要依赖。 |
| 服务类型、版本/特性要求与依赖槽位 | connections 有显式绑定；requires/before/after、深度及重入限制已实现 | apiVersion=1 和 priority 无法表达需要何种语音服务、媒体接口或恢复特性。安装和配置时应能检查能力、版本及可用性，并说明具体阻塞原因。 |
| 呈现的主输出、附加输出和异步协议 | delivery.presentation 是首个有效结果获选，结果为 text/artifactIds | 这个模式适用于选择一个主呈现器。TTS、图卡、字幕和附件要同时保留时，需要清楚的保留/替换/附加槽位与失败回退。耗时呈现还需要与 Outbox/Job 衔接的 pending 协议，不能靠延长所有同步 Hook 的期限。 |
| 入站仲裁与持久事件到任务的契约 | 六个核心 Hook 有真实位置、schema、可写路径和组合规则；自定义 point 已实现 | message.recorded 的观察不等于输入接管。需要接管、过滤或触发后台业务的插件，应有明确处理结果和仲裁规则。增加 priority 不能把 observe 变成阻断或任务提交能力。 |
| 可解释的有效编排图与调用诊断 | 全局 UI 枚举内置节点；实例页能预览各 point 的处理器顺序 | 全局视图主要基于默认配置，尚不能完整解释当前范围、selector、权限和自定义 point 下真正生效的图。应展示被排除原因、必要依赖、服务绑定和实际调用结果。 |

依据：[manifest](../../pkgs/plugins/src/manifest.ts)、[注册表](../../pkgs/plugins/src/registry.ts)、[实际切入点](../../pkgs/plugins/src/hooks/points.ts)、[呈现选择](../../pkgs/plugins/src/hooks/presentation.ts)、[插件 Job](../../pkgs/plugins/src/jobs/runner.ts)、[全局编排视图](../../pkgs/plugins/src/pipeline/editor.ts)、[实例编排视图](../../pkgs/plugins/src/configuration/order.ts)。

## 建议的下一轮实施顺序

1. 用 TTS 和一个入站媒体处理插件验证具名服务、mediaId 读取、Artifact、Job、取消和单次交付，形成两个完整迁移闭环。
2. 用一个被动采样/订阅插件验证事件到 Job、插件计划、持久所有权和停用/升级行为。
3. 在实际业务链上补齐服务/效果声明、异步呈现及有效编排诊断，再决定是否需要更通用的数据流编排。

每个闭环都应能说明：输入来自哪里、权限何时固定和复核、持久对象归谁、何时可以重试、未知结果怎样核对、谁发送最终消息、取消后会保留什么。

## 核心代码组织

Coordinator 仍同时承担入站、直接指令、受理恢复、执行装配、鉴权入口、插件呈现和任务衔接。修复可靠性后，可以按职责抽出入站受理服务、指令路由和 Invocation 装配服务，保留单一协调入口。插件宿主当前依赖 PreparedRunInput 等 Agent DTO；后续宜让通用的 Bot InvocationContext 成为直接指令、观察事件和 Agent 调用的共同领域上下文，再由 Pi Bridge 构造模型输入。这样可减少插件能力扩展时对 Agent 执行细节的牵连。
