# 具名 ComfyUI、受管资源与恢复

`comfy@1` 由 Core 管理端点、认证、workflow、远端任务回执和 Artifact。Worker 负责提示词、LoRA 与业务政策，不取得网络、宿主路径或服务凭据。

## 配置流程

1. 安装含 `comfy@1` 连接的插件，检查 grants。
2. 在「服务与技能 → ComfyUI 服务与工作流」导入 Comfy API format 的受管模板。
3. 配置服务 ID、URL、私有 Headers、启停和允许的 workflow IDs。
4. 在插件实例中绑定服务，设置默认 workflow、允许范围和其他业务政策。

模板和模型库存只保存操作员登记的相对路径与标量映射，不扫描宿主目录。资源校验不保证自定义节点、模型或 GPU 环境可用；导入与保存配置本身不访问 Comfy。

模板声明 `graph`、`parameters`、`bindings`、`outputs`、`models`、`loras`。参数只写入操作员登记的标量路径，并校验类型、范围和编码。输出必须来自已登记节点，图像下载只接受预期格式和受限的文件路径。

## Worker RPC

manifest 使用 `{alias:'render', kind:'service', service:'comfy@1'}`，然后调用 `context.host('service:render', input)`。

| action | 用途 |
| --- | --- |
| `catalog` | 分页读取 workflow、参数、模型和 LoRA 目录，不请求上游 |
| `submit` | 在可信 execute 阶段提交一个 item |
| `poll` / `recover` | 用 Core 保存的回执查询原服务，不创建新任务 |
| `peek` | 查看本地回执元数据，区分未派发与未知提交 |
| `cancel` | 只精确删除能够确认属于本任务且仍在排队的远端 ID |
| `reconcile` | 显式只读核对，包括已停止自动等待的 item |

每个 item 返回 recordId、attempted、hasReceipt、status、artifactIds，以及可选请求 Artifact、workflow 摘要和错误。`attempted` 只表示尝试过提交，不代表远端接纳。`not_started`、`submitted/running`、业务终态、`outcome_unknown`、`abandoned` 应分别处理。

## 提交、恢复与取消

Core 根据实例、范围、Job、revision、item 和服务别名构造所有者。提交前保存服务快照、模板和参数摘要、请求 JSON 与输出约束；远端 prompt ID 在返回 Worker 前保存。相同所有者重复提交时，只有服务 revision、workflow 摘要和参数摘要均匹配才返回原回执；任一不匹配都会拒绝，且不会再次 POST。

后台 operation 可声明 `recover`。execute 回执丢失、任务未建立句柄或恢复时，Core 调用 `{input, handle, intent}`；普通 poll/cancel 使用 `{handle}`。只有 execute 阶段允许 `submit`，防止轮询或核对重复创建任务。

查询始终使用原服务快照。端点、认证、启停、模板许可、grants 或目标发生不兼容变化时停止后续操作，不把原 ID 发给另一服务。

取消先保存意图。只有 queue 仍明确包含本任务的排队 ID 时才请求精确删除；已开始运行但服务不提供单任务中断时，只能停止本地等待并保留 abandoned/unknown，不能宣称 GPU 已停止。未知删除不自动重发。

## 状态、结果与交付

公共状态接口：

- `state.read {area:'scope'|'instance', key}` → `{version,value}`。
- `state.compare {area,key,version,value}` → `{applied,version}`。

CAS 状态适合无数据操作的小型协调状态，不等于挂载私有卷。业务事实不完整时保留 `factsComplete:false` 和 `outcome_unknown`；手动核对只补充原事实与 Artifact，不重发已确认聊天内容。

`PluginResult.format` 可为 `direct` 或 `forward`。支持 forward 的适配器保存逐部分真实回执；不支持时在发送前显示实际降级格式，未知回执不换成另一种格式重发。typed forward 整条视为 mixed，因此自动语音呈现不会只取其中文字。

## 模型历史投影

`model.history@1` 可返回 `hideArguments`，仅过滤本实例登记 operation 在模型历史中的工具参数。它不改变原始 Pi 审计、IM 消息、恢复回执或提交 JSON，也不追溯修改已有压缩摘要。

无数据操作按可信前后台使用独立 lane，同一 lane 内串行，所有 lane 共用 Worker 与请求总预算。业务参数不能提升调用类别或绕过容量。
