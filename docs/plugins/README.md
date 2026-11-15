# Pi IM Bot 插件开发手册

本文档描述 `apiVersion: 1` 的可调用接口。未列出的内部对象或方法不属于插件公共 API。

## 文档导航

| 主题                               | 文档                                          |
| ---------------------------------- | --------------------------------------------- |
| 包布局、manifest、配置与服务绑定   | [包与配置](package-and-config.md)             |
| 工具、指令和参数解析               | [触发与路由](triggers-and-routing.md)         |
| Bot RPC、授权与产物                | [Bot 能力](bot-capabilities.md)               |
| 核心 Hook、自定义 point 和插件协作 | [Hook 与编排](hooks-and-composition.md)       |
| 后台任务、恢复、数据与取消         | [异步与数据](async-and-data.md)               |
| 构建、安装和发布                   | [开发与分发](development-and-distribution.md) |
| 异步媒体呈现                       | [受管呈现](managed-presentation.md)           |
| GSVI 与入站媒体                    | [具名语音与媒体](managed-media-and-speech.md) |
| GSVI 配置字段                      | [GSVI 配置](gsvi-native-configuration.md)     |
| ComfyUI 服务与恢复                 | [ComfyUI](managed-comfy.md)                   |

框架源码中的公共 SDK、manifest schema、Host RPC 和 hook point 定义是接口依据。插件摘要与文档快照由开发工作区维护。

## 职责与上下文

Pi 负责模型循环和会话，Bot 负责可信身份、资源、权限、任务和交付，插件实现业务逻辑。插件不直接取得 Bot、平台 adapter、Provider、Scheduler 或通用宿主网络对象。

插件默认导出 `operations`、`hooks`、`parsers` 字典：

```ts
import { definePlugin, textResult } from "@pi-im-bot/plugin-sdk"
import { z } from "zod"

const InputSchema = z.object({ text: z.string() }).strict()

export default definePlugin({
  operations: {
    echo(input) {
      return textResult(InputSchema.parse(input).text)
    }
  }
})
```

`@pi-im-bot/plugin-sdk` 由开发工作区映射到本仓库公共 SDK，不是独立发布的 npm 包。发布入口必须包含运行所需代码与依赖。

## 运行模型

一个插件可提供 Pi 工具、直接指令、Hook、自定义 point 和后台 operation。调用上下文包含固定设置、可信范围、触发者、授权和取消信号；私有文件位于 `context.dataDir`。

Worker 网络关闭、代码只读，不继承宿主环境或 Docker socket。外部访问通过已声明的 MCP 或具名服务完成。操作和实例声明 grant 后，仍须通过范围选择与触发人权限检查。

公共能力包括历史与媒体读取、Artifact 读写、额外发送、本次回执撤回、MCP、跨插件 operation、系统状态和具名 GSVI/ComfyUI 服务。通用 HTTP、任意 Provider 调用、插件自注册 Cron、任意跨群发送、宿主 Shell/文件系统和自定义前端页面不属于公共 API。

「运行环境」管理执行依赖，实例配置管理 schema 和服务绑定。安装、配置、启用和当前触发人获准是独立条件，页面诊断用于定位未满足的条件。
