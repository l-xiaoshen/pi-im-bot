# 具名 GSVI 服务与入站媒体

GSVI 连接由 Core 管理端点、凭据、HTTP、下载和 Artifact。Worker 只传递业务参数，不取得服务 URL 认证信息或通用网络能力。

## GSVI 具名服务

实例配置可直接编辑连接与语音参数，见 [GSVI 配置](gsvi-native-configuration.md)。也可独立管理服务并在插件中绑定别名。

manifest 声明固定服务类型：

```json
{
  "connections": [{ "alias": "speech", "kind": "service", "service": "gsvi@1" }]
}
```

通过 `context.host('service:speech', input)` 调用：

| action       | 用途                        | 附加要求                           |
| ------------ | --------------------------- | ---------------------------------- |
| `voices`     | 查询所选版本的声音目录      | `tts_voices`                       |
| `synthesize` | 合成文字并返回 WAV Artifact | `tts_synthesize`、`artifact.write` |

operation/handler 与实例均需 `service:speech` grant。一次调用可包含有界的一组目录查询和一次合成；服务 HTTP 并发、RPC、Artifact 和调用期限共同构成预算。

认证只随同源请求发送；音频下载重定向会重新计算认证，跨源不转发旧 Header。显式 Authorization 覆盖自动 Bearer。URL 内凭据不会交给 Worker、模型或日志。响应、合成和下载遵循服务总期限，未知响应不自动重提。

成功合成返回 Core Artifact ID 与音频元数据。业务失败和不确定结果使用脱敏状态；取消和撤权不会被转换成成功的文字回退。

## 读取本聊天媒体

```ts
const media = await readMedia(context, {
  mediaId,
  offset: 0,
  limit: 65536,
  maxBytes: 8 * 1024 * 1024
})
```

`readMedia` 调用 `media.read`，需要 handler/实例的 `media.read` grant 和业务 `media_read`。`mediaId` 可来自规范化附件，或 `history.read` 返回的 `{source:'media', id}`；后者还需要历史读取权限。

返回 `{mediaId,name,mimeType,bytes,offset,base64,hasMore}`，不包含下载 URL、签名、宿主路径或内部 backing Artifact ID。`limit=0` 只读取元数据。

读取受当前范围、源消息撤回状态、平台来源、单文件大小、总字节和不同来源数量约束。相同来源的并发读取共享下载；RPC 不自动重试失败下载，用户可显式重试。

## 来源与归档

受管媒体读取、Artifact 复制、跨插件 operation、MCP 产物和再次发布会传播相关媒体来源。发布和交付前重新检查撤回状态及业务授权。

归档内容的查看只依赖聊天范围、内容存在和媒体来源状态，不要求原生产插件仍启用。新发布与新交付还要求当前实例、grant 和服务绑定有效。

来源传播只覆盖受管调用链，不是任意信息流追踪。插件已保存的副本、远端服务保留的请求和模型上下文中的文字不能由 Bot 自动推导或回收。

## 自动语音呈现

语音政策可以在 `delivery.presentation@1` 中做短时选择，耗时合成由本实例 background operation 执行，并继续原交付 Outbox。混合内容、无适配条件或容量不可用时保留原文字与附件。详见 [受管异步呈现](managed-presentation.md)。
