# 受管异步呈现

`delivery.presentation@1` 可以同步返回 `{text, artifactIds}`，也可以返回本实例后台 operation 的 render 请求：

```ts
return {
  render: {
    operation: 'render',
    arguments: { text: input.text, voice: 'default' }
  }
}
```

Hook 只负责选择，不能在 Hook 内等待长合成或挂起后台 Promise。render operation 必须属于同一插件实例，并使用 `background` + `data:none`；不能改选 Actor、目的地、群或另一个实例。

## Core 构造的选择上下文

除常规 DeliveryView 字段外，呈现器可读取：

| 字段           | 含义                                                                                               |
| -------------- | -------------------------------------------------------------------------------------------------- |
| `producer`     | `agent-final`、`scheduled-agent`、`background-agent`、`agent-tool`、`plugin`、`control`、`unknown` |
| `deferred`     | 当前入口是否支持异步呈现；为 `false` 时只能同步选择                                                |
| `content`      | `plain` 或 `mixed`；含 Artifact 或 typed forward 的内容为 mixed                                    |
| `capabilities` | 选择器声明且当前获准的能力子集，只用于选择诊断                                                     |

来源由 Core 根据实际执行入口设置，不能从昵称、文本、run ID 或插件参数推断。输入消息中的引用不会把另一条纯文字输出变成 mixed。

呈现器可通过 `inspectCapabilities` 声明少量需要检查的能力。该列表反映选择时的状态，不是执行凭据；受理、服务调用和交付仍会重新授权。

## 受理与真实回执

选中异步 render 后，Core 固定所需配置、参数、权限和服务版本，并以原 outbound ID 幂等受理呈现 Job。Job 只执行选中的 operation，继续原 Outbox，不重跑 Agent、不额外发送一条普通 Job 通知。

`accepted` 或工具返回的 `{delivered:false, jobId}` 表示呈现工作已接纳，不是平台已发送。最终回执使用 `sent`、`partial`、`unknown`、`suppressed` 等状态；同步发送仍等待真实平台 ACK。

`chat_present` 供 Agent 明确请求可呈现的额外通知，需要 `chat_present` 与 `chat_send`。普通 `chat_send` 和 Agent 工具上下文中的 `delivery.send` 可使用有界同步呈现；普通插件指令和插件业务 Job 不冒充 Agent 来源。

一次逻辑交付只做一次呈现决定，不按模型 token/delta 重复选择。Pi 原文和消息历史保留原文字，呈现只修改实际发送副本。

## 失败、取消与恢复

- 已知呈现失败可按插件策略保存文字回退，并继续一次原文字/附件交付。
- 提交或 Job 受理结果未知时保留 `unknown`，通过原请求核对，不重新选择或重新提交外部工作。
- 已保存的文字回退拥有交付权，迟到音频不会再次发送。
- `/stop`、`/new`、目标切换和撤权会停止后续呈现及交付，已成功部分保留真实回执。
- 重启复用已保存的呈现决定、Job 与配置快照，不重新抽概率或选择处理器。

## 数据与容量

`data:none` 只控制数据隔离：不挂载私有卷，不能发布私有文件，但仍可通过具名服务生成 Core Artifact。前后台无数据调用使用独立 lane，数据 lane 与调用预算是不同概念。

自动 render 受全局、范围、父任务和 Worker 容量约束。明确容量拒绝会保存决定并走原内容回退；未知受理不会被误当作容量拒绝。后台无数据调用必须为前台控制保留容量，所有 lane 仍共用 Worker 总预算。
