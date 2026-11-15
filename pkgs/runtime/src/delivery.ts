import { sendTransport } from './transport'
import type { ChatMessage, Room } from '@pi-im-bot/contracts/message'
import type { ChannelRegistry } from '@pi-im-bot/channels/registry'
import type { StateStore } from '@pi-im-bot/storage/state'
import type { EventHub } from '@pi-im-bot/contracts/events'
import type { Outbound } from '@pi-im-bot/contracts/delivery'
import { PartialDelivery, SendBlocked } from '@pi-im-bot/contracts/channel-media'
import type { ArtifactStore } from '@pi-im-bot/artifacts/store'
import { prepareMedia } from '@pi-im-bot/artifacts/delivery'
import type { ArtifactAccess } from '@pi-im-bot/artifacts/access'
import { deliveryMessage } from '@pi-im-bot/storage/delivery-merge'
import { DeliveryDeferred, RenderAdmissionRejected } from '@pi-im-bot/contracts/rendering'
import {
  DeliverySuppressed,
  PresentationResultSchema,
  type DeliveryPresentation
} from '@pi-im-bot/contracts/presentation'
export { DeliverySuppressed } from '@pi-im-bot/contracts/presentation'

export class DeliveryUncertain extends Error {}
export class DeliveryAdmissionUnknown extends DeliveryUncertain {
  constructor(readonly outboundId: string) {
    super('呈现受理结果待核对，未确认发送；未重新选择或提交')
  }
}
export class DeliveryCancelled extends Error {}

export interface DeliveryOptions {
  authorize?(capability: string): void
  artifactIds?: readonly string[]
  beforePart?(): void | Promise<void>
  format?: 'direct' | 'forward'
  itemized?: boolean
  presentation?: DeliveryPresentation
}

export class DeliveryService {
  validateReadAccess?: (roomId: string, access: ArtifactAccess) => void
  validateAccess?: (roomId: string, access: ArtifactAccess) => void
  private readonly pending = new Map<string, Promise<ChatMessage>>()

  constructor(
    private readonly channels: ChannelRegistry,
    private readonly store: Pick<StateStore, keyof StateStore>,
    private readonly events: EventHub,
    private readonly artifacts?: (roomId: string) => ArtifactStore
  ) {}

  async send(
    room: Room,
    text: string,
    runId?: string,
    role: 'assistant' | 'system' = 'assistant',
    operationId: string = crypto.randomUUID(),
    options: DeliveryOptions = {}
  ): Promise<ChatMessage> {
    const pending = this.pending.get(operationId)
    if (pending) {
      await pending.catch(() => {})
      return this.send(room, text, runId, role, operationId, options)
    }
    const operation = this.dispatch(room, text, runId, role, operationId, options)
    this.pending.set(operationId, operation)
    try {
      return await operation
    } finally {
      this.pending.delete(operationId)
    }
  }

  private async dispatch(
    room: Room,
    text: string,
    runId: string | undefined,
    role: 'assistant' | 'system',
    operationId: string,
    options: DeliveryOptions
  ) {
    const artifactIds = [...new Set(options.artifactIds ?? [])]
    let existing = this.store.getOutbound(operationId)
    if (existing) {
      if (
        existing.roomId !== room.id ||
        (existing.format ?? 'direct') !== (options.format ?? 'direct') ||
        Boolean(existing.itemized) !== Boolean(options.itemized) ||
        existing.text !== text ||
        existing.role !== role ||
        existing.runId !== runId ||
        existing.conversationId !== room.currentConversationId ||
        JSON.stringify(existing.requestedArtifactIds ?? existing.artifactIds) !==
          JSON.stringify(artifactIds) ||
        existing.presentationKey !== options.presentation?.key
      ) {
        throw new Error('交付幂等键与已有操作不匹配')
      }
      if (existing.state === 'sent') {
        const message = this.store.getMessage(existing.messageId)
        if (message) {
          return message
        }
        throw new Error('交付已完成，但原消息记录不可读取；未重复发送')
      }
      if (existing.state === 'suppressed') {
        throw new DeliverySuppressed(existing.error ?? '交付已隐藏')
      }
      if (existing.state === 'cancelled') {
        throw new DeliveryCancelled(existing.error ?? '原交付已停止，未自动重发')
      }
      if (existing.state === 'failed') {
        throw new Error(existing.error ?? '原交付处理失败，未重复执行')
      }
      if (existing.state === 'rendering') {
        if (!existing.inlineRender) {
          existing = await this.defer(existing, options)
        }
      }
      if (existing.state !== 'prepared' && !(existing.state === 'rendering' && existing.inlineRender)) {
        throw new DeliveryUncertain('原交付结果未知，未自动重复发送或执行呈现。请查看会话记录。')
      }
    }
    await options.beforePart?.()
    if (!existing && artifactIds.length > 0) {
      const artifacts = this.artifacts?.(room.id)
      if (!artifacts) {
        throw new Error('产物存储未配置')
      }
      for (const id of artifactIds) {
        await artifacts.metadata(id)
      }
    }
    let outbound: Outbound = existing ?? {
      id: operationId,
      roomId: room.id,
      conversationId: room.currentConversationId,
      runId,
      text,
      format: options.format,
      itemized: options.itemized,
      effectiveFormat: 'direct',
      deliveryParts: [],
      attachments: [],
      artifactIds,
      requestedArtifactIds: artifactIds,
      presentationKey: options.presentation?.key,
      presentationHandlers: [],
      cancelRequested: false,
      role,
      state: 'preparing',
      messageId: crypto.randomUUID(),
      platformMessageIds: [],
      createdAt: Date.now()
    }
    if (!existing) {
      this.store.saveOutbound(outbound)
      try {
        let result = PresentationResultSchema.parse({ text, artifactIds, allow: true })
        if (options.presentation) {
          result = PresentationResultSchema.parse(
            await options.presentation.prepare(text, artifactIds, options.format === 'forward')
          )
        }
        options.presentation?.validate(result.handlers)
        outbound = {
          ...outbound,
          renderedText: result.text,
          artifactIds: result.artifactIds,
          presentationHandlers: result.handlers,
          render: result.render,
          state: 'prepared'
        }
        if (!result.allow || (!result.text.trim() && result.artifactIds.length === 0)) {
          outbound.state = 'suppressed'
          outbound.error = result.reason ?? '交付内容为空，未发送'
        } else if (result.render) {
          if (options.presentation?.captureAdmission && options.presentation.enqueue) {
            outbound.renderAdmission = options.presentation.captureAdmission()
          } else if (options.presentation?.inline) {
            outbound.inlineRender = 'planned'
          } else {
            throw new Error('此发送入口未提供受管异步呈现')
          }
          outbound.state = 'rendering'
        }
        this.store.saveOutbound(outbound, this.observation(options, outbound))
      } catch (error) {
        this.store.saveOutbound({ ...outbound, state: 'failed', error: '呈现处理未完成，未自动重复执行' })
        throw error
      }
    }
    if (outbound.state === 'rendering') {
      if (outbound.inlineRender) {
        outbound = await this.inline(outbound, options)
      } else {
        outbound = await this.defer(outbound, options)
      }
    }
    if (outbound.state === 'suppressed') {
      this.notify(options, outbound)
      throw new DeliverySuppressed(outbound.error)
    }
    const beforePart = async () => {
      try {
        if (this.store.getOutbound(outbound.id)?.cancelRequested) {
          throw new Error('交付已停止')
        }
        await options.beforePart?.()
        if (outbound.inlineRender) {
          options.presentation?.validateInline?.(outbound)
        }
        if (outbound.renderFallback) {
          options.presentation?.validateRender?.(outbound)
        }
        for (const id of outbound.artifactIds) {
          const metadata = await this.artifacts?.(room.id).metadata(id)
          if (metadata?.access) {
            this.validateAccess?.(room.id, metadata.access)
            for (const capability of metadata.access.capabilities) {
              if (!options.authorize) {
                throw new Error('产物交付缺少来源授权上下文')
              }
              options.authorize(capability)
            }
          }
        }
        options.presentation?.validate(outbound.presentationHandlers)
      } catch (error) {
        throw new SendBlocked(error)
      }
    }
    const prepared = await prepareMedia(
      room.id,
      outbound.artifactIds,
      this.artifacts?.(room.id),
      this.channels.get(room.address.channel).capabilities
    )
    let deliveredText = outbound.renderedText ?? text
    if (prepared.downloads.length > 0) {
      deliveredText +=
        '\n以下附件暂不直接发送（平台支持或大小限制），可在 Web 会话或任务页下载：' +
        prepared.downloads.join('、')
    }
    // A revision or cancellation may change while artifact contents are being read.
    try {
      await beforePart()
      outbound = {
        ...outbound,
        renderedText: deliveredText,
        attachments: prepared.attachments,
        state: 'sending'
      }
      this.store.saveOutbound(outbound, this.observation(options, outbound))
      let format: 'direct' | 'forward' = 'direct'
      if (outbound.format === 'forward' && this.channels.get(room.address.channel).capabilities.forward) {
        format = 'forward'
      }
      outbound.effectiveFormat = format
      const receipt = await sendTransport(
        this.channels,
        room.address,
        deliveredText,
        prepared.media,
        format,
        Boolean(outbound.itemized),
        {
          beforePart,
          received: (messageIds, sentAt) => {
            outbound.cancelRequested ||= this.store.getOutbound(outbound.id)?.cancelRequested ?? false
            outbound.platformMessageIds = messageIds
            outbound.sentAt = sentAt
            this.store.saveOutbound(outbound, this.observation(options, outbound))
          }
        },
        (artifactIds, platformMessageIds) => {
          outbound.deliveryParts = [...(outbound.deliveryParts ?? []), { artifactIds, platformMessageIds }]
          this.store.saveOutbound(outbound, this.observation(options, outbound))
        }
      )
      const completed: Outbound = {
        ...outbound,
        state: 'sent',
        platformMessageIds: receipt.messageIds,
        sentAt: receipt.sentAt
      }
      const message = this.record(completed, options)
      this.notify(options, completed)
      return message
    } catch (error) {
      if (error instanceof PartialDelivery) {
        outbound.platformMessageIds = error.messageIds
        outbound.sentAt = error.sentAt
      }
      let blocked = error instanceof SendBlocked
      if (error instanceof PartialDelivery && error.cause instanceof SendBlocked) {
        blocked = true
      }
      if (blocked) {
        const stopped: Outbound = {
          ...outbound,
          state: 'cancelled',
          error: '交付在下一段发送前停止；已有回执的内容仍已发送，未自动重发'
        }
        if (stopped.platformMessageIds.length > 0) {
          this.record(stopped, options)
        } else {
          this.store.saveOutbound(stopped, this.observation(options, stopped))
        }
        this.notify(options, stopped)
        throw new DeliveryCancelled(stopped.error, { cause: error })
      }
      const uncertain: Outbound = {
        ...outbound,
        state: 'unknown',
        uncertaintyStage: 'transport',
        error: '发送回执不可确认，未自动重发'
      }
      this.record(uncertain, options)
      this.notify(options, uncertain)
      throw new DeliveryUncertain('发送回执不可确认，结果已保留，未自动重发。', { cause: error })
    }
  }

  private async defer(outbound: Outbound, options: DeliveryOptions): Promise<Outbound> {
    if (!options.presentation?.enqueue) {
      throw new Error('呈现等待受管恢复，未发送或重新选择')
    }
    let jobId: string
    try {
      jobId = await options.presentation.enqueue(outbound)
    } catch (error) {
      const latest = this.store.getOutbound(outbound.id) ?? outbound
      if (latest.cancelRequested || latest.state !== 'rendering') {
        throw new DeliveryCancelled('呈现已停止')
      }
      try {
        await options.beforePart?.()
        options.presentation.validateRender?.(latest)
        options.presentation.validate(latest.presentationHandlers)
      } catch (blocked) {
        if (this.store.getOutbound(outbound.id)?.state === 'rendering') {
          this.store.saveOutbound({ ...latest, state: 'suppressed', error: '呈现受理已停止或撤权' })
        }
        throw new DeliverySuppressed('呈现受理已停止或撤权', { cause: blocked })
      }
      if (!(error instanceof RenderAdmissionRejected)) {
        throw new DeliveryAdmissionUnknown(outbound.id)
      }
      const fallback: Outbound = { ...latest, state: 'prepared', renderFallback: error.rejection }
      this.store.saveOutbound(fallback)
      return fallback
    }
    const latest = this.store.getOutbound(outbound.id) ?? outbound
    this.store.saveOutbound({ ...latest, renderJobId: jobId })
    if (latest.cancelRequested || latest.state === 'cancelled') {
      throw new DeliveryCancelled('呈现受理期间已停止')
    }
    throw new DeliveryDeferred(jobId)
  }

  private async inline(outbound: Outbound, options: DeliveryOptions): Promise<Outbound> {
    if (outbound.inlineRender !== 'planned') {
      this.store.saveOutbound({
        ...outbound,
        inlineRender: 'unknown',
        state: 'unknown',
        uncertaintyStage: 'presentation',
        error: '原短时呈现结果未知，未重复执行或发送'
      })
      throw new DeliveryUncertain('原短时呈现已中断，未重新合成或发送')
    }
    try {
      await options.beforePart?.()
      options.presentation?.validate(outbound.presentationHandlers)
      options.presentation?.validateInline?.(outbound)
      const admitted = this.store.getOutbound(outbound.id) ?? outbound
      if (admitted.cancelRequested || admitted.state !== 'rendering') {
        throw new DeliveryCancelled('短时呈现已停止')
      }
      this.store.saveOutbound({ ...admitted, inlineRender: 'started' })
      const result = await options.presentation!.inline!(outbound)
      await options.beforePart?.()
      options.presentation?.validate(outbound.presentationHandlers)
      options.presentation?.validateInline?.(outbound)
      const latest = this.store.getOutbound(outbound.id) ?? outbound
      if (latest.cancelRequested || latest.state !== 'rendering') {
        throw new DeliveryCancelled('短时呈现期间已停止')
      }
      const prepared: Outbound = { ...latest, inlineRender: 'fallback', state: 'prepared' }
      if (result) {
        prepared.renderedText = result.text
        prepared.artifactIds = result.artifactIds
        prepared.inlineRender = 'complete'
      }
      this.store.saveOutbound(prepared)
      return prepared
    } catch (error) {
      const cancelled: Outbound = {
        ...(this.store.getOutbound(outbound.id) ?? outbound),
        inlineRender: 'unknown',
        state: 'cancelled',
        error: '短时呈现已停止或撤权，未发送迟到内容'
      }
      this.store.saveOutbound(cancelled, this.observation(options, cancelled))
      this.notify(options, cancelled)
      throw new DeliveryCancelled(cancelled.error, { cause: error })
    }
  }

  async completeRender(
    room: Room,
    id: string,
    result: { text: string; artifactIds: string[] } | undefined,
    options: DeliveryOptions
  ) {
    const outbound = this.store.getOutbound(id)
    if (!outbound?.render) {
      throw new Error('呈现计划不存在')
    }
    if (outbound.state === 'rendering') {
      await options.beforePart?.()
      this.store.saveOutbound({
        ...outbound,
        renderedText: result?.text ?? outbound.renderedText ?? outbound.text,
        artifactIds: result?.artifactIds ?? outbound.requestedArtifactIds ?? [],
        state: 'prepared'
      })
    }
    return this.send(room, outbound.text, outbound.runId, outbound.role, id, {
      ...options,
      artifactIds: outbound.requestedArtifactIds,
      presentation: {
        key: outbound.presentationKey ?? '',
        async prepare() {
          throw new Error('已保存呈现不可重新选择')
        },
        validate: options.presentation?.validate ?? (() => {})
      }
    })
  }

  private notify(options: DeliveryOptions, outbound: Outbound) {
    try {
      options.presentation?.receipt?.(outbound)
    } catch {
      /* Observations cannot alter a committed delivery. */
    }
  }

  private observation(options: DeliveryOptions, outbound: Outbound) {
    if (!['sending', 'sent', 'unknown', 'suppressed', 'cancelled'].includes(outbound.state)) {
      return undefined
    }
    try {
      return options.presentation?.observation?.(outbound)
    } catch {
      return undefined
    }
  }

  private record(outbound: Outbound, options: DeliveryOptions = {}) {
    const saved = this.store.saveDelivery(
      deliveryMessage(outbound),
      outbound,
      this.observation(options, outbound)
    )
    this.events.emit({ type: 'message', ...saved })
    return saved.message
  }

  async recall(room: Room, messageId: string, beforePart?: () => void) {
    const message = this.store.getMessage(messageId)
    if (!message || message.roomId !== room.id || message.role === 'user') {
      throw new Error('Only a recorded bot message can be recalled')
    }
    const adapter = this.channels.get(room.address.channel)
    if (!adapter.recall) {
      throw new Error('This channel does not support recall')
    }
    if (message.deliveryState === 'unknown' && message.platformMessageIds.length === 0) {
      throw new Error('发送回执未知，没有可撤回的平台消息 ID')
    }
    for (const id of message.platformMessageIds) {
      if (message.recalledPlatformIds?.includes(id)) {
        continue
      }
      beforePart?.()
      await adapter.recall(room.address, id)
      const updated = this.store.recordRecall(room.id, id)
      if (updated) {
        this.events.emit({ type: 'message', message: updated })
      }
    }
    message.recalled = true
    message.recalledPlatformIds = [...message.platformMessageIds]
    this.store.saveMessage(message)
    this.events.emit({ type: 'message', message })
  }
}
