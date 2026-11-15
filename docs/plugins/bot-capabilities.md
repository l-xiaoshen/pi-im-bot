# Bot RPC 能力参考

统一入口为 `await context.host(method, params)`。返回值类型为 `unknown`，插件应使用 Zod 或 SDK schema 校验。

每次调用同时受 operation/handler grants、实例 grants、固定触发上限和调用时权限约束。参数不能改选群、身份或其他高权限主体。

```ts
import { RuntimeStatusSchema } from "@pi-im-bot/plugin-sdk"

const status = RuntimeStatusSchema.parse(await context.host("system.status", {}))
context.signal.throwIfAborted()
```

| 方法                              | grant                | 参数与结果                                                           |
| --------------------------------- | -------------------- | -------------------------------------------------------------------- |
| `system.status`                   | `system.status`      | `{}` → `RuntimeStatusSchema`；另需 `runtime_status`                  |
| `history.read`                    | `history.read`       | `limit` 1–100，默认 20 → 当前范围的投影消息；另需 `chat_history`     |
| `artifact.read`                   | `artifact.read`      | `id`、offset、limit → 分段 Base64；另需 `artifact_read`              |
| `artifact.write`                  | `artifact.write`     | name、mimeType、text/base64 data → 新 Artifact                       |
| `artifact.publish`                | `artifact.write`     | 相对 path、可选 name/mimeType → 从私有卷流式发布普通文件             |
| `delivery.send`                   | `delivery.send`      | text、artifactIds → 当前范围额外通知；另需 `chat_send`               |
| `delivery.recall`                 | `delivery.recall`    | messageId、delayMs → 本次已确认回执的持久撤回；另需 `message_recall` |
| `connector:<别名>`                | 同名 connector grant | tool、arguments → 调用绑定的 MCP，另需对应工具权限                   |
| `operation:<依赖>/<操作>`         | 同名 operation grant | arguments、phase → 跨插件 execute/poll/cancel                        |
| `point:plugin.self.<名称>@<版本>` | 同名 point grant     | value → 启动本实例声明的 point                                       |

具名 `media.read`、`service:<别名>` 和受管状态见 [语音与媒体](managed-media-and-speech.md)、[ComfyUI](managed-comfy.md)。

## 系统状态

`system.status` 返回 Bot 控制面可见的 CPU、内存、文件系统、网络、进程、插件和 Provider 摘要，以及可用的 NVIDIA GPU 摘要。它不返回主机名、IP、绝对路径、环境变量、命令参数或配置正文。

这些指标属于 Bot 所在命名空间，不等于插件 Worker 或宿主物理机器的完整指标。Worker 不因此获得 NVIDIA 设备或原始命令输出。`runtime_status` 是动作权限，不是模型工具名。

## 发布文件

```ts
import { join } from 'node:path'
import { z } from 'zod'

const ArtifactSchema = z.object({ id: z.uuid() })
await Bun.write(join(context.dataDir, 'report.txt'), '业务结果')
const artifact = ArtifactSchema.parse(
  await context.host('artifact.publish', {
    path: 'report.txt',
    name: 'report.txt',
    mimeType: 'text/plain'
  })
)
return { text: '已生成报告', artifactIds: [artifact.id] }
```

写完并关闭文件后再发布。发布完成后，Artifact 独立于私有卷中的临时文件保存。大文件使用 `artifact.publish`，不要转成 Base64 放入工具文本。

## MCP 与插件协作

```ts
const result = await context.host("connector:images", {
  tool: "generate_image",
  arguments: { prompt: "一张插画" }
})
```

实例绑定提供连接器别名，插件不会收到 MCP Header 或上游凭据。只读 Hook 只能调用目录和调用时都声明 `readOnlyHint: true` 的 MCP 工具。

跨插件 operation 需要显式依赖，目标只收到自己的设置和原范围。循环调用、Worker 重入或资源耗尽会被拒绝；捕获错误后不能换一个未授权范围、身份或服务重试。

## 非公共能力

`storage.read/write` 不是可调用的文件接口，文件使用 `context.dataDir`。通用 `llm.generate`、`http.fetch`、`schedule.create`、`agent.delegate`、`config.save`、`render.html` 和平台 adapter RPC 未开放。

缺少能力时，应增加有明确输入输出、授权和期限的受管服务，而不是暴露整个 Bot 对象。
