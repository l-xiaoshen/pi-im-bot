# Pi IM Bot 插件开发手册

适用范围：当前 `apiVersion: 1`、Bun 1.4.4、Pi 1.5.0 的实际实现。更新日期：2026-11-13。这里记录已经提供的接口；设计提案与未来能力不作为可调用 API。

新配置的插件执行默认关闭；这是默认值，并非部署状态。2026-11-12 的部署记录已确认启用，2026-11-13 只读 `GET /api/plugins/observers` 再次返回 enabled:true。当前开关和实例阻塞原因看在线观察/运行环境诊断；普通开发、构建与打包不会改变它们。

| 要解决的问题                       | 文档                                          |
| ---------------------------------- | --------------------------------------------- |
| 写第一个插件、声明代码与配置       | [包与配置](package-and-config.md)             |
| 工具、指令、QQ/Mock 路由、参数解析 | [触发与指令路由](triggers-and-routing.md)     |
| Bot 提供的 RPC、授权、调用格式     | [Bot 能力参考](bot-capabilities.md)           |
| 上下文、文字、呈现、观察与插件协作 | [Hook 与编排](hooks-and-composition.md)       |
| 后台任务、取消、恢复、文件与持久化 | [异步与数据生命周期](async-and-data.md)       |
| 构建、验证、打包和 GitHub 发布     | [开发与分发](development-and-distribution.md) |
| 如何迁移 AstrBot Python 插件       | [迁移指南](migration.md)                      |

框架源码是接口依据：`pkgs/plugins/src/manifest.ts`、`sdk/index.ts`、`sdk/worker.ts`、`rpc/protocol.ts`、`host.ts`、`commands.ts`、`service.ts`、`hooks/points.ts`、`runtime/config.ts`。迁移工作区会在 `docs/bot-api/snapshot.json` 中保存这些文件的摘要。

## 模型与插件分别负责什么

Pi 负责模型循环、工具使用、会话、压缩及后台 Agent。Bot 负责消息入口、可信身份、配置、能力注册、执行隔离、持久任务、产物和交付。插件实现独立业务操作，通过副本与 RPC 协作。

一个群/私聊/Mock 范围共享当前 conversation、人格和偏好。群员是发言来源及授权输入，不是另一套插件用户状态。同一插件的实例/聊天范围有自己的持久数据；不能用发言者昵称当作宿主权限凭据。

插件默认导出 `operations`、`hooks`、`parsers` 三种实现字典。不存在公开的 `context.bot`、`context.adapter`、`context.llm`、`context.scheduler` 或通用宿主 fetch。不要从当前源码中的内部类推断出插件已经取得了这些对象。

## 最小示例

```ts
import { definePlugin, textResult } from '@pi-im-bot/plugin-sdk'
import { z } from 'zod'

const InputSchema = z.object({ text: z.string() }).strict()

export default definePlugin({
  operations: {
    echo(input) {
      const args = InputSchema.parse(input)
      return textResult(args.text)
    }
  }
})
```

`@pi-im-bot/plugin-sdk` 是迁移工作区的构建别名，指向真实 Bot 公共 SDK，当前不是已发布的 npm 包。构建会把需要的 SDK 代码和依赖打进发布入口。包声明、配置及指令仍需按下一篇文档添加。

## 当前可用与边界

foundation A 新增 [具名 GSVI 与入站媒体](managed-media-and-speech.md)：固定语音协议、mediaId 有界读取、来源传播及归档读取策略。

- 可提供 Pi 工具、直接指令、七个核心 Hook、自定义 point 和跨插件 operation；工具与指令可共用一个操作。
- 可读取本范围历史/产物、发布产物、额外发送、安排本次回执撤回、调用已绑定 MCP、读取授权的 Bot 系统状态。
- 可用统一 Job 承接后台操作及 `pending` 句柄，不必持有主会话等待。
- 文件与任意业务代码只在插件 Worker 内运行；Worker 网络关闭，代码只读，私有数据有容量上限。
- 配置编辑来自静态 `_conf_schema.json`，资源选择器只返回引用 ID，不等于提供相应服务调用。
- 未提供：插件自注册 Cron、任意跨群发送、直接调用任意 Provider、任意 HTTP/通用语音连接器（已提供固定 GSVI 服务）、HTML 渲染服务、任意宿主 Shell/文件系统、配置型文件上传、通用数据迁移或初始化/销毁生命周期 API。

插件执行环境在「插件 → 运行环境」统一检测和配置，保存后应用。实例配置只包含 schema 与声明的服务绑定；账号、群、conversation 覆盖不混入实例编辑入口。运行环境和所需 grant 未满足时，页面显示对应阻塞原因及操作。

安装成功、配置完成与执行可用是不同状态。开发测试不能自行启用正式执行或修改容器。完整的竞品能力核查与缺口见 Bot 主仓库 `docs/framework/plugin-product-and-capabilities.md`。

短时选择、持久呈现 Job、可信 producer 与真实 ACK 入口见 [受管异步呈现](managed-presentation.md)。

具名 comfy@1、受管模板、CAS 状态、逐 item 恢复/精确取消、typed forward 与模型参数投影见 [ComfyUI 公共接口](managed-comfy.md)。

GSVI 0.3 的原字段、嵌套预设、同页凭据编辑与刷新缓存契约见 [GSVI 原生配置页](gsvi-native-configuration.md)。
