# Hook、呈现与插件编排

「插件 → 编排」由实际 point 声明生成。处理器启停和优先级会改变真实调用；只有声明 Hook 的插件需要实例编排页。

Hook 独立于模型工具，每个 handler 使用 `hook:plugin:<实例>/<id>` 权限。插件通过输入副本和返回值协作，不共享可变事件对象。

## 核心切入点

| point / mode                       | 用途                                               |
| ---------------------------------- | -------------------------------------------------- |
| `context.collect@1` / collect      | 为当前模型请求提供带来源、去重且有总预算的附加片段 |
| `delivery.visibility@1` / policy   | 决定是否隐藏本次交付，任一有效拒绝即隐藏           |
| `delivery.text@1` / transform      | 在呈现前按顺序变换 `/text`                         |
| `delivery.presentation@1` / select | 选择第一个有效的文字、Artifact 或异步 render 呈现  |
| `delivery.receipt@1` / observe     | 消费持久交付事实，可安排本次回执撤回               |
| `message.recorded@1` / observe     | 观察当前范围的规范化消息，包括未触发模型的消息     |
| `model.history@1` / collect        | 为模型历史提供本实例工具参数的显示策略             |

DeliveryView 包含逻辑消息 ID、范围、conversation、origin、phase、text 和 artifactIds。Receipt 还提供 originalText、实际呈现文字和平台回执 ID；`sent`、`unknown`、`suppressed` 等状态不能混为成功发送。

## 按字段变换

```json
{
  "id": "tidy",
  "point": "delivery.text@1",
  "mode": "transform",
  "writes": ["/text"],
  "priority": 10,
  "timeoutMs": 1000,
  "onError": "skip"
}
```

```ts
import { definePlugin, replaceText } from "@pi-im-bot/plugin-sdk"

export default definePlugin({
  hooks: {
    tidy(input, context) {
      return replaceText(context, input.text.replace(/\n{3,}/gu, "\n\n"))
    }
  }
})
```

`replaceText` 使用本次 `inputRevision` 生成 patch。Core 检查 point 写范围、handler.writes、版本和完整结果；非法 patch 整份拒绝，不保留部分修改。

## 呈现与撤回

呈现器读取处理后的文字，可以返回 `{text, artifactIds}`、返回 `null` 放弃接管，或返回本实例后台 operation 的 render 请求。耗时媒体工作由受管任务执行，不改变 Pi 原文，也不直接调用平台发送。详见 [受管异步呈现](managed-presentation.md)。

回执观察器只能在确认状态合适时安排本次逻辑消息的撤回：

```ts
await context.host("delivery.recall", {
  messageId: receipt.messageId,
  delayMs: 180000
})
```

它需要 handler/实例的 `delivery.recall` grant 和触发人的 `message_recall` 权限。等待由 Core 持久任务执行，不在 Worker 内 `sleep`。

主回复、插件指令、主动发送与 Job 结果进入同一交付账本；模型原文、呈现结果和分部平台回执分别保存。控制指令与错误提示使用核心直达路径。

## 排序与失败

- `before` / `after` / `requires` 先于 priority；优先级只控制允许调整的顺序。
- selector 可限定 channel、origin、phase，范围和实时权限继续过滤。
- `onError: skip` 沿用最后有效值，`fail` 终止该流程；取消始终终止。
- collect、policy、transform 只能调用只读宿主能力，select 可按授权生成产物。
- 所有 Hook 都不能直接 `delivery.send`。

## 自定义 point

拥有者在 `manifest.points` 声明 point 的 mode、schema 和 writable，通过 `point:plugin.self.<名称>@<版本>` 启动：

```ts
const prepared = await context.host("point:plugin.self.prepare@1", {
  value: { prompt: "业务输入" }
})
```

其他插件通过显式依赖绑定 `plugin.<拥有者实例>.prepare@1`，不能冒充拥有者启动其 point。Core 校验输入、每份变换结果和最终输出；schema 验证 Worker 不加载业务入口或私有数据。

自定义 point 支持 transform、collect、select、policy、exclusive 和 observe。长业务应转为后台 Job，不能依靠提高 Hook timeout 突破父任务期限。
