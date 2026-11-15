# 从 AstrBot Python 插件迁移

迁移业务行为和显式契约，不复制宿主 patch、私有事件对象或平台全局状态。开始前确认许可证、配置、数据归属和实际使用的入口。

## 机制映射

| AstrBot 用法 | 本框架机制 |
| --- | --- |
| command、alias | `manifest.commands` + operation + parser |
| `llm_tool` | `manifest.operations`，`tool=true` |
| Star.config、`_conf_schema.json` | 静态表单 + `invocation.settings` |
| 数据目录 | `context.dataDir`，按实例和聊天范围隔离 |
| event/session 回复 | 返回 PluginResult；额外通知使用 `delivery.send` |
| 后台 task、sleep 等结果 | background operation + pending/poll/cancel，或持久观察动作 |
| 直接平台 API | 受管交付、回执和撤回；新增能力需明确 Core 服务 |
| monkeypatch 模型或发送流程 | context、text、presentation、receipt 等固定切入点 |
| Provider、MCP 凭据 | Core 保管，插件使用连接器或服务引用 |
| 主机指标 | `system.status`，不用 Worker 的 OS 指标代替 |

## 迁移检查

1. 列出指令、工具、被动处理、后台行为及其启用条件。
2. 确认数据属于全局、实例、聊天范围、conversation 还是触发人。群共享状态不要误拆为成员私有 Agent 状态。
3. 将配置分为业务偏好、服务绑定和凭据；凭据放入 Core 托管字段。
4. 为每次外部副作用定义提交检查点、取消和恢复语义，未知提交不盲目重试。
5. 长任务使用后台 Job，Worker 不作为常驻守护进程。
6. 使用现有 Hook 替代发送链 patch，保留模型原文和平台实际呈现的区别。
7. 核对核心保留指令和资源权限，不为同名功能创造第二条路由。
8. 明确列出未迁移能力及所需服务，不将“可安装”视作“功能兼容”。

语音类业务可将策略放在 `delivery.presentation@1`，合成由获准的具名服务和受管 Job 完成，音频发布为 Artifact；失败回退与取消由同一交付账本处理。通用 HTTP 未开放时，不应通过开放 Worker 网络绕过服务边界。
