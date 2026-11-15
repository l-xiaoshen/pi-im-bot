# 异步操作、数据和生命周期

## 后台句柄

```json
{
  "id": "generate",
  "title": "生成结果",
  "description": "提交耗时工作",
  "execution": "background",
  "timeoutMs": 10000,
  "inputSchema": { "type": "object", "properties": {} },
  "poll": "poll_generation",
  "cancel": "cancel_generation"
}
```

`operations` 需实现 `generate`、`poll_generation`、`cancel_generation`。后两者是阶段 handler，不必额外暴露为模型工具。

提交后返回：

```ts
return {
  status: 'pending',
  handle: { taskId: '服务返回的任务号' },
  pollAfterMs: 1000,
  message: '已提交'
}
```

poll/cancel 接收 `{ handle }`，不会重复收到 execute 原始参数。可用 `handleSchema`、`pollInputSchema`、`cancelInputSchema`、`recoverInputSchema` 声明各阶段契约；`reconcile` 使用 poll schema。句柄是私有执行数据，不进入群消息或普通工具结果。

完成返回 `{status:'done', result:{text,artifactIds,value?,suppressText?}}`，也可直接返回 PluginResult。失败和确认取消分别使用 `failed`、`cancelled`。无法确认取消时保持未知或仍在执行，不返回虚假终态。

## 重启与副作用

Core 在提交前保存检查点，并固定代码、配置、范围、授权和服务快照。已确认完成的业务请求不重放；提交或取消回执未知时保存 `outcome_unknown`，不自动再提交。

只读查询可以使用原句柄继续，但当前权限、实例状态、范围和取消仍会约束后续动作。`poll` 不能再次调用创建任务的接口。外部 API 若提供幂等键，应由插件在业务协议中明确使用。

Job 结果由 Core 统一交付，后台 handler 不直接 `delivery.send`。直接指令进入后台时先返回受理信息，完成后通过 `/jobs` 和任务页查询。前台 operation 不适合无限等待，长任务应直接声明后台模式。

## 调用上下文与私有数据

`PluginContext` 提供 `dataDir`、`invocation`、`signal`、`host(method,params)`。invocation 包含实例、固定 revision、范围、conversation、origin、actors、settings、grants、deadline 和 inputRevision，均为本次调用的副本。

`context.dataDir` 为 `/data/files`。同一实例、同一聊天范围共享数据，不同实例和范围隔离；升级与切换 conversation 不自动清空数据。数据 schema 和升级逻辑由插件负责。

Worker 可能被回收，因此：

- 模块变量只保存可丢弃缓存。
- 重要状态写入私有数据或受管 CAS 状态，使用明确的一致性策略。
- import 时不启动网络、定时器、永久循环或平台监听器。
- 所有 Host RPC 在返回前完成或取消，不使用 fire-and-forget 代替 Job。
- 文件发布为 Artifact 后清理不再需要的卷内副本。

`data:scope` 提供同实例/范围的私有数据串行访问；`data:none` 不挂载私有卷，前后台使用独立调用 lane。数据隔离与执行类别是独立维度。

## 预算与取消

父任务、operation、Worker 和运行时取消都可能形成更早期限。I/O 应使用 `context.signal`，在发布、发送和返回前检查取消。同步 CPU/WASM 工作需要自行约束输入规模。

队列满、嵌套互等或 Worker 重入会及时失败。超时返回不等待慢容器清理；尚未确认回收的 Worker 仍占资源名额。

最终回复和工具直发在每个发送分部前复核取消与权限。已发送部分保留回执，停止后续分部可形成 partial；结果未知时不自动重发。

## 受理与任务历史

消息归档和业务受理分开记录。队列满或等待过期会明确拒绝；`/stop` 先取消待受理消息，再停止已建任务。`/new`、渠道切换和停用使用相同的停止语义。核心控制指令有独立的有限受理容量，但仍执行权限检查。

任务列表优先显示活动项，已完成项分页查询。Job 修订会生成新 revision，列表展示当前版本；完整 Job ID 始终可用于查询或控制。模型可见任务摘要、私有提交句柄和平台交付回执分别保存。

受管呈现的 accepted 只表示已接纳呈现工作，不表示平台 sent，详见 [受管异步呈现](managed-presentation.md)。ComfyUI 的 CAS 状态与无句柄恢复见 [ComfyUI](managed-comfy.md)。
