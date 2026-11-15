import { fauxAssistantMessage, fauxProvider, fauxToolCall } from '@earendil-works/pi-ai/providers/faux'

export function createDemoProvider() {
  return fauxProvider({ provider: 'pi-im-demo', tokensPerSecond: 160 })
}

export function prepareDemo(provider: ReturnType<typeof createDemoProvider>, prompt: string) {
  provider.setResponses([
    fauxAssistantMessage(fauxToolCall('chat_history', { limit: 3 }), { stopReason: 'toolUse' }),
    fauxAssistantMessage(
      `这是离线演示，未调用真实 LLM。\n\n收到：${prompt}\n\n本轮已通过 Pi 执行 chat_history 工具。填写 config/providers.json、重载配置并将会话切换到「真实模型」后，便可测试 Responses、工具调用和 provider 故障转移。`
    )
  ])
}
