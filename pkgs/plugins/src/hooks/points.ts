import { z } from 'zod'
import { AddressSchema } from '@pi-im-bot/contracts/message'
import { ChatMessageSchema } from '@pi-im-bot/contracts/message'
import { OutboundSchema } from '@pi-im-bot/contracts/delivery'
import { PatchPathSchema } from './path'
import { RenderRequestSchema } from '@pi-im-bot/contracts/rendering'

export const DeliveryPhaseSchema = z.enum([
  'final',
  'intermediate',
  'progress',
  'tool-direct',
  'notification',
  'control'
])
export type DeliveryPhase = z.infer<typeof DeliveryPhaseSchema>
export const DeliveryViewSchema = z.object({
  id: z.string(),
  roomId: z.string(),
  address: AddressSchema,
  conversationId: z.string(),
  origin: z.enum(['im', 'command', 'schedule', 'job', 'tool', 'admin']),
  phase: DeliveryPhaseSchema,
  producer: z
    .enum([
      'agent-final',
      'scheduled-agent',
      'background-agent',
      'agent-tool',
      'plugin',
      'control',
      'unknown'
    ])
    .default('unknown'),
  deferred: z.boolean().default(false),
  content: z.enum(['plain', 'mixed']).default('mixed'),
  capabilities: z.array(z.string()).max(16).default([]),
  text: z.string().max(100000),
  artifactIds: z.array(z.uuid()).max(256)
})
export type DeliveryView = z.infer<typeof DeliveryViewSchema>
export const TransformPatchSchema = z
  .object({
    baseRevision: z.string(),
    patch: z
      .array(
        z.discriminatedUnion('op', [
          z.object({ op: z.literal('set'), path: PatchPathSchema, value: z.json() }).strict(),
          z.object({ op: z.literal('remove'), path: PatchPathSchema }).strict()
        ])
      )
      .max(100)
  })
  .strict()
export const VisibilityDecisionSchema = z
  .object({ allow: z.boolean(), reason: z.string().max(500).optional() })
  .strict()
export const PresentationChoiceSchema = z.union([
  z.object({ text: z.string().max(100000), artifactIds: z.array(z.uuid()).max(12) }).strict(),
  z.object({ render: RenderRequestSchema }).strict()
])
export const ContextContributionSchema = z
  .object({
    fragments: z.array(z.object({ key: z.string().min(1).max(80), text: z.string().max(16000) })).max(20)
  })
  .strict()

export const ContextInputSchema = z.object({ text: z.string().max(20000) }).strict()
export const ReceiptInputSchema = z.object({
  phase: DeliveryPhaseSchema,
  id: z.string(),
  messageId: z.string().optional(),
  state: OutboundSchema.shape.state,
  text: z.string(),
  originalText: z.string(),
  artifactIds: z.array(z.uuid()),
  platformMessageIds: z.array(z.string())
})
export const RecordedInputSchema = z.object({ message: ChatMessageSchema })

// The same declarations identify executable call sites and generate the Web catalog.
export const contextCollectNode = {
  id: 'context.collect@1',
  title: '补充模型上下文',
  stage: 'agent',
  position: 'before',
  order: 20,
  mode: 'collect',
  writable: [],
  input: ContextInputSchema,
  output: ContextContributionSchema,
  flow: '收到消息 → 准备上下文 → Pi',
  source: 'pkgs/plugins/src/hooks/context.ts',
  summary: '并行收集有来源的片段，合并去重后受统一字符预算限制。'
} as const
export const visibilityNode = {
  id: 'delivery.visibility@1',
  title: '决定是否发送',
  stage: 'delivery',
  position: 'before',
  order: 40,
  mode: 'policy',
  writable: [],
  input: DeliveryViewSchema,
  output: VisibilityDecisionSchema,
  flow: 'Agent / 指令 / Job 结果 → 发送判断',
  source: 'pkgs/plugins/src/hooks/presentation.ts',
  summary: '任一拒绝即可隐藏，后续处理器不能重新放行。'
} as const
export const textNode = {
  id: 'delivery.text@1',
  title: '处理回复文字',
  stage: 'presentation',
  position: 'before',
  order: 50,
  mode: 'transform',
  writable: ['/text'],
  input: DeliveryViewSchema,
  output: TransformPatchSchema,
  flow: '发送判断 → 文字变换 → 媒体呈现',
  source: 'pkgs/plugins/src/hooks/presentation.ts',
  summary: '按顺序应用带版本的文字 patch；越权或不合法的数据整份拒绝。'
} as const
export const presentationNode = {
  id: 'delivery.presentation@1',
  title: '选择文字或媒体呈现',
  stage: 'presentation',
  position: 'after',
  order: 60,
  mode: 'select',
  writable: ['/text', '/artifactIds'],
  input: DeliveryViewSchema,
  output: PresentationChoiceSchema.nullable(),
  flow: '文字变换 → TTS / 图片等呈现 → 平台发送',
  source: 'pkgs/plugins/src/hooks/presentation.ts',
  summary: '第一个有效呈现器获选。文件通过产物 ID 流转，地址和身份不可改写。'
} as const
export const receiptNode = {
  id: 'delivery.receipt@1',
  title: '处理发送回执',
  stage: 'delivery',
  position: 'after',
  order: 70,
  mode: 'observe',
  writable: [],
  input: ReceiptInputSchema,
  output: z.unknown(),
  flow: '平台发送 → 持久回执观察 → 例如延后撤回',
  source: 'pkgs/runtime/src/coordinator.ts',
  summary: '持久异步观察，返回值不改变消息；只对已确认回执执行后续动作。'
} as const
export const recordedNode = {
  id: 'message.recorded@1',
  title: '观察已记录消息',
  stage: 'message',
  position: 'after',
  order: 10,
  mode: 'observe',
  writable: [],
  input: RecordedInputSchema,
  output: z.unknown(),
  flow: 'IM 消息 → 保存原始记录 → 指令 / Agent 路由',
  source: 'pkgs/runtime/src/coordinator.ts',
  summary: '持久异步观察；包括未触发模型的普通消息，不阻塞主对话。'
} as const
export const historyProjectionNode = {
  id: 'model.history@1',
  title: '模型可见工具参数投影',
  stage: 'agent',
  position: 'before',
  order: 25,
  mode: 'collect',
  writable: [],
  input: z.object({}).strict(),
  output: z.object({ hideArguments: z.array(z.string().regex(/^[a-z][a-z0-9_-]{0,47}$/u)).max(32) }).strict(),
  flow: 'Pi beforeRequest / context → scoped projection → 模型',
  source: 'pkgs/plugins/src/hooks/model-history.ts',
  summary: '处理器只能请求隐藏自己实例的指定工具参数；保留原始Pi/IM审计与恢复记录。'
} as const
export const builtinPluginPoints = [
  historyProjectionNode,
  recordedNode,
  contextCollectNode,
  visibilityNode,
  textNode,
  presentationNode,
  receiptNode
]
