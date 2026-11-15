# 插件协议与流程编排

状态：历史草案，已由 [Bot 框架设计](framework/README.md) 替代。本文件保留早期 TTS/撤回分析，不再作为完整插件规范。新的设计以实际启用配置和近期使用为基线，区分数据加工、偏好、行为、内置基建和扩展资源；33 个安装目录只作为功能索引。

## 插件角色

| 扩展点 | 输入 / 输出 | 执行方式 |
| --- | --- | --- |
| Trigger / Command | 平台消息、Cron、指令 → TaskEnvelope 或核心 Action | 按路由匹配，不得隐式抢占所有事件 |
| Context provider | scope、查询 → 带来源和 token 预算的片段 | 有界并行；必需/可选与超时策略显式声明 |
| Tool | Pi 工具参数 → 结构化结果/产物 | 核心注册 schema，实际执行走 worker RPC |
| Presenter | ReplyDraft → 新的 DeliveryPlan / Artifact | 核心配置依赖和顺序，不原地修改共享对象 |
| Observer | 已提交的事件/回执 → 异步工作 | 独立队列、重试和熔断，不阻塞 Agent/发送 |
| Channel adapter | 平台输入 / DeliveryPlan / Receipt | 核心维护 QQ、TG、Mock；第三方适配器走相同能力协议 |

不提供“任意时刻拿到整个 Bot/Pi 对象”的通用插件接口，不允许 monkeypatch 核心、全局 EventEmitter 阻塞回调或共享可变上下文。

## Worker 和 manifest

核心只读 manifest 并注册 RPC 代理，不 import 插件入口代码。每个 plugin/version 有独立 worker；有作用域隐私要求的插件按 plugin/version/scope 建实例，空闲回收，不能把多个 scope 的明文缓存无条件混放。

单独 Bun 进程只隔离崩溃，不能隔离文件权限。第三方 worker 必须位于 [执行服务](sandbox-runtime.md) 管理的 OS 沙箱。可信的内置 core capability 和不可信的插件包是两个类别，不能允许插件自报 trusted 绕开隔离。

manifest 草案：

~~~json
{
  "id": "tts",
  "version": "0.1.0",
  "apiVersion": 1,
  "entry": "dist/worker.js",
  "contributes": {
    "presenters": [
      {
        "id": "speech",
        "input": "reply.text",
        "output": "artifact.audio"
      }
    ]
  },
  "requests": {
    "capabilities": ["speech.synthesize", "artifact.write"],
    "data": "own-scope",
    "network": "none"
  },
  "limits": {
    "maxConcurrent": 1,
    "timeoutMs": 15000
  }
}
~~~

manifest 声明的是请求，不是批准。有效权限取插件声明、部署 profile、当前 actor/scope 的交集。worker 的身份由 supervisor 注入的会话通道绑定，不信任它传回的 pluginId、scopeId、权限或 deadline。插件可声明 schema 和能力需求，不能决定自己的挂载。

安装过程先下载固定 digest/版本并校验 manifest，依赖构建在构建沙箱内完成；不得在核心运行安装脚本。插件包只读发布，升级切换版本指针，在途任务继续旧版本。数据迁移只授予该插件的 namespace，先备份；代码回滚不等于数据 schema 自动回滚。

RPC 先采用有帧边界和大小限制的 JSON 消息，通过私有管道/受限 socket。包含 requestId、runId、能力句柄和相对 deadline；输入输出各用 Zod/声明 schema 验证。不要先引入消息总线或 RPC 平台；持久队列语义由核心状态层负责。

## 统一流程

~~~mermaid
flowchart TD
  T["IM / 指令 / Cron"] --> A["去重、准入、任务配置快照"]
  A --> X["上下文与能力装配"]
  X --> P["Pi agent loop"]
  P --> R["ReplyDraft / Action"]
  R --> V["输出策略与 Presenter DAG"]
  V --> O["持久 Outbox"]
  O --> D["Channel adapter"]
  D --> Q["DeliveryReceipt / Unknown / Failed"]
  Q --> E["持久事件 → 独立 Observer 队列"]
  E --> J["撤回 Job 等后续工作"]
~~~

TaskEnvelope 至少包含触发类型、来源事件 ID、actor、Address、sessionKey、workspaceScope、profileRevision、pluginVersions、deadline、token/tool 预算。Cron 创建时固定归属，触发时重新检查有效权限；它不能成为跨 scope 提权入口。/stop、/status 等控制指令绕开业务队列，仍由核心执行。

Context provider 输出不可变片段，携带 source/trust/priority/maxTokens；核心去重、裁剪与确定顺序。插件内容属于模型输入，不升级为系统权限，也不因此自动执行代码。Tools 仅装载本任务所需 schema，保留 Pi 会话、压缩与原生工具循环。

每次任务固定插件和 pipeline 版本。编排只允许已声明的有类型阶段，加载时校验缺失依赖、类型不匹配、环路、重复 presenter 目标。顺序由核心 profile 确定；不用安装顺序或“priority 数字大就能改所有东西”。

首版的编排配置是简单 JSON/DAG，只有需要的几个阶段。普通工具动作可经策略直接走对应核心能力；涉及聊天发送的动作必须走同一交付管线，不能让 chat_send 绕过 TTS/审计/回执。

## TTS 与撤回的具体拆分

1. Pi 输出原始文本，核心保存 ReplyDraft。它是模型语义结果，后续音频呈现不覆盖 Pi 对话历史。
2. profile 选择 TTS presenter。worker 得到本次文本和音色配置，经 speech.synthesize 生成音频，返回 artifactId、mime、时长和文本关联；不直接拿 OneBot/TG 对象发消息。
3. presenter 生成 DeliveryPlan，声明发送语音还是文本+语音；核心依据渠道 capabilities 决定可交付形式。QQ/TG 需要不同音频格式时，由媒体转换能力处理。
4. TTS 有明确预算，例如 15 秒。可选语音超时/失败只发送原文本；“必须语音”策略则明确失败。迟到结果不能在文本已发后自行补发。
5. Outbox 记录逻辑 replyId、deliveryId、组成部分和幂等键，再由渠道发送。收到回执后保存所有平台 messageId。
6. 撤回插件订阅 delivery.succeeded，按策略创建 durable recall job。倒计时从成功交付时间开始；任务执行使用 receipt 中的平台 ID，经核心权限校验调用 recall。
7. 发送结果未知或失败不启动撤回计时。部分成功只处理成功部分；一个 reply 发出多条平台消息则跟踪多条回执。

撤回插件不需要读取或改写 TTS 的文本/音频，也不依赖 TTS 是否启用。TTS 产物被 Outbox/Receipt 引用期间不能被 GC。撤回延迟通过持久调度执行，不占用会话锁，也不增加 LLM 调用。

## 阻塞、并发和副作用

- Pi session 和 workspace 各有自己的串行/单写边界；全局并发、每插件并发、每阶段队列和外部 API 限流分开管理。
- 模型结束后尽早释放 Pi session/workspace 资源。慢 TTS 和平台发送在交付队列运行，只保持需要的会话交付顺序，不能占着全局 Agent 槽位。
- Context 和 presenter 有明确 deadline、失败策略、熔断和输出上限。一个可选插件失败不延长其他插件预算；必需阶段失败可终止对应任务，但必须有上限。
- 观察者按插件维护独立消费进度和重试；毒性事件进入失败队列。事件至少一次交付，消费者必须幂等，不声称通用 exactly-once。
- 有副作用的能力记录 operationId 与 pending/succeeded/failed/unknown。Provider fallback 仅重试单次模型请求，绝不重放整轮已执行工具。
- 平台支持幂等键时使用；不支持时，网络超时可能意味着已经发送，标 unknown 并核对，不盲目重发。内部 outbox 本身不能消除平台的不确定性。
- 取消从 Run 传播到工具 RPC、子任务和 guest。已发生的发送/外部写入不能假装撤销；按回执和补偿策略单独处理。
- 超过短任务预算的工作转成持久 Job，返回 jobId；完成后发事件。不要长时间持有 Agent 会话去等待数分钟的转码/抓取。
- 第三方插件不可在原始核心 EventHub.subscribe 中运行；当前给 UI 的内存事件流不是插件的持久事件总线。

## 实施接口与目录

建议按职责增加以下模块，而不是先改写全部现有实现：

~~~text
pkgs/execution/src/       后端协议、租约、Pi operation adapters
pkgs/artifacts/src/       元数据、授权、导入导出、引用与回收
pkgs/plugins/src/         manifest、包注册、worker RPC、权限与健康
src/orchestration/   阶段定义、profile 编译、ReplyDraft/DeliveryPlan
pkgs/runtime/src/         现有入口协调，逐步引入 outbox 与持久事件
pkgs/channels/src/        QQ / TG / Mock 协议转换与 capability
~~~

插件 SDK 只暴露上下文、数据、产物、任务、明确授权的外部能力；不暴露原始 DB handle、任意宿主 fs、Bot 对象、Provider 凭据或任意 URL 的 host fetch。

现有交付接口只有 text，需要演进为结构化内容和分部回执；现有 coordinator 把模型与发送串在一起，需要拆出交付生命周期。保持可独立验收的阶段迁移，不为了兼容内部旧接口保留另一套隐式 hook。

## 首批验收场景

1. TTS 挂死：到 deadline 降级文本，其他会话和工具插件继续工作。
2. TTS 成功 + 撤回：音频按真实平台 ID 撤回，模型历史保持原始文本。
3. 插件崩溃/重启：只重启其 worker，持久数据仍在，旧能力句柄失效。
4. 插件尝试读取其他插件数据或发往另一群：核心拒绝，不能靠伪造 RPC 字段越权。
5. TTS 进行中 /stop，随后迟到结果：不补发；已确认发送的消息按既定策略处理。
6. 发送超时、部分成功和重复回执：记录准确状态，不重复发送/重复创建撤回 job。
7. 插件更新时有在途任务：旧任务完成或取消后回收旧版本，新任务使用新版本。

只在实现对应行为时补必要回归；不为草案添加空壳测试或数据库测试。
