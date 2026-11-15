# 触发、指令与路由

## 入口

| 形式 | 声明 | 执行方式 |
| --- | --- | --- |
| 模型工具 | `operation.tool=true` | Pi 选择已装载且获准的工具 |
| 直接指令 | `commands` 绑定 operation | Bot 解析并调用，无需模型 |
| Hook | `hooks` 绑定 point | Core 在固定阶段调用 |
| 普通消息/回执观察 | observe handler | 持久 outbox 与独立任务 |
| 后台操作 | `execution=background` | Job 管理提交、轮询、取消和结果 |
| 计划任务 | Bot Cron 选择相应能力 | 复用 Agent/Job 生命周期 |

QQ 消息先按测试目标和 Agent 触发规则处理，再匹配核心控制指令与插件指令。Mock 使用相同的指令路由。插件自注册 Cron 不在 manifest 能力中。

核心保留 `/help`、`/status`、`/stop`、`/new`、`/skills`、`/skill`、`/jobs`、`/job`，插件不能占用。业务指令需要显式登记别名；实例停用、范围未选择或后端未就绪时，不会改为调用模型补救。

## 指令与内置参数

指令形式为 `/名称` 或 `/名称 参数`，匹配时忽略大小写。别名可使用字母、数字、下划线、连字符或中文，但不能包含空格；子命令交给 parser。

```json
{
  "id": "echo",
  "names": ["echo"],
  "operation": "echo",
  "arguments": "text",
  "textField": "text"
}
```

- `text`：剩余文本写入 `textField`，例如 `/echo hello` → `{ "text": "hello" }`。
- `json`：剩余文本必须是 JSON 对象，空参数为 `{}`。
- `none`：只接受空参数并传 `{}`。

解析结果仍由 operation 的 `inputSchema` 校验。

## 自定义 parser

manifest 在 command 中声明 `"parser": "status_args"`：

```ts
import { definePlugin } from '@pi-im-bot/plugin-sdk'
import { z } from 'zod'

const InputSchema = z.object({ format: z.enum(['text', 'json']) })

export default definePlugin({
  parsers: {
    status_args({ text }) {
      const value = text.trim()
      if (value === '' || value === '--json') {
        return { format: value === '' ? 'text' : 'json' }
      }
      throw new Error('用法：/状态 [--json]')
    }
  },
  operations: {
    inspect(input) {
      const args = InputSchema.parse(input)
      return { text: args.format }
    }
  }
})
```

parser 接收 `{text}` 并返回对象。它运行于隔离 Worker，没有额外宿主 grants，不应发送消息、提交任务或修改业务状态。不要用参数中的 actor、群号或角色替换可信调用上下文。

## 权限与结果

直接指令同时需要：

```text
command:plugin:<实例>/<command.id>
plugin:<实例>/<operation.id>
```

实例 grants、范围选择、触发身份和调用时权限检查继续生效。排队后、执行前及交付前都会复核取消与授权。群 Agent 关闭不影响已授权的直接指令。

前台结果直接进入统一呈现和交付流程，通常只需 `return` PluginResult，不应再额外发送同一内容。后台 operation 先返回任务受理信息，完成后由 Job 交付。

`context.invocation.origin` 表示可信来源类别，`actors` 保留触发者。它们用于路由和诊断，不替代权限检查；多人合批仍取权限交集。
