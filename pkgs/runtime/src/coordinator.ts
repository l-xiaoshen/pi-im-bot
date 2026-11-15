import { assertArtifactAccess, assertArtifactDeliveryAccess } from '@pi-im-bot/plugins/artifact-access'
import type { Configuration } from '@pi-im-bot/config/load'
import {
  RoomSchema,
  addressKey,
  type ChatMessage,
  type Room,
  type IncomingMessage,
  type InboundOutcome
} from '@pi-im-bot/contracts/message'
import type { Run, RunInput, PreparedRunInput, Trace, ExecutionContext } from '@pi-im-bot/contracts/run'
import { BACKGROUND_CONTEXT, withAbortSignal, awaitWithContext } from '@earendil-works/chord/context'
import { executeRun } from './execute-run'
import type { HostToolServices } from '@pi-im-bot/agent/host-tools'
import type { StateStore } from '@pi-im-bot/storage/state'
import { DeliverySuppressed, DeliveryAdmissionUnknown, type DeliveryService } from './delivery'
import type { EventHub } from '@pi-im-bot/contracts/events'
import type { Scheduler } from '@pi-im-bot/scheduler/service'
import type { ScheduleToolServices } from '@pi-im-bot/agent/schedule-tools'
import { executionStatus } from '@pi-im-bot/execution/config'
import { oneBotAllowed } from '@pi-im-bot/channels/onebot/config'
import { isBuiltinCommand, isControlCommand, extractPrompt } from './trigger'
import { executeJobCommand, isJobCommand, jobCommandHelp } from '@pi-im-bot/jobs/commands'
import { ConversationService } from '@pi-im-bot/conversations/service'
import { resolveSettings } from '@pi-im-bot/settings/resolve'
import { captureAuthority, assertCapability } from '@pi-im-bot/permissions/authorize'
import { localIdentity, type TriggerIdentity, type Authority } from '@pi-im-bot/permissions/identity'
import { projectHistory, projectOutput } from '@pi-im-bot/messages/projection'
import { freezeSnapshot } from './snapshot'
import { requestedSkill } from '@pi-im-bot/resources/skills/invocation'
import { skillCapabilityId } from '@pi-im-bot/resources/skills/package'
import type { DurableAgentRuntime } from '@pi-im-bot/agent/durable/runtime'
import { ConfigurationSnapshots } from '@pi-im-bot/config/snapshots'
import { runObserver } from './run-observer'
import { ConversationInbox } from './inbox'
import type { QueuedExecution } from './execution-request'
import type { JobService } from '@pi-im-bot/jobs/service'
import type { JobInvocation } from '@pi-im-bot/jobs/service'
import type { MediaService } from '@pi-im-bot/media/service'
import type { ReplyReference } from '@pi-im-bot/media/schema'
import {
  attachmentReferences,
  quoteContext,
  type QuoteContext,
  type ImageReference
} from '@pi-im-bot/media/provenance'
import { createMediaProjection } from '@pi-im-bot/media/projection'
import type { Schedule } from '@pi-im-bot/scheduler/definition'
import { ScheduleOverlap } from '@pi-im-bot/scheduler/occurrences'
import type { PluginService } from '@pi-im-bot/plugins/service'
import { findPluginCommand, executePluginCommand, pluginCommandHelp } from '@pi-im-bot/plugins/commands'
import { pluginOperationId } from '@pi-im-bot/plugins/identity'
import { pluginPresentation } from '@pi-im-bot/plugins/hooks/presentation'
import type { DeliveryPhase } from '@pi-im-bot/plugins/hooks/points'
import type { PluginInvocation } from '@pi-im-bot/plugins/invocation'
import { PluginObservations } from '@pi-im-bot/plugins/observations/service'
import type { ChatMessage as ObservedMessage } from '@pi-im-bot/contracts/message'
import { receiptNode, recordedNode } from '@pi-im-bot/plugins/hooks/points'
import { DeliveryDeferred } from '@pi-im-bot/contracts/rendering'
import type { DeliveryView } from '@pi-im-bot/plugins/hooks/points'
import type { Outbound } from '@pi-im-bot/contracts/delivery'

interface ActiveRun {
  roomId: string
  controller: AbortController
  run: Run
  completion: PromiseWithResolvers<Run>
}

export class Coordinator {
  observations?: PluginObservations
  plugins?: PluginService
  private readonly queues = new Map<string, Promise<void>>()
  private readonly active = new Map<string, ActiveRun>()
  private scheduler?: Scheduler
  private durable!: DurableAgentRuntime
  private snapshots!: ConfigurationSnapshots
  private readonly recovery: QueuedExecution[] = []
  private closing = false
  private jobs?: JobService
  private media?: MediaService
  private readonly inbox: ConversationInbox
  private recoveringInbound = false
  private controlDispatches = 0
  private readonly jobCancellations = new Set<Promise<void>>()
  readonly conversations: ConversationService

  constructor(
    private readonly configuration: () => Configuration,
    readonly store: Pick<StateStore, keyof StateStore>,
    readonly events: EventHub,
    readonly delivery: DeliveryService
  ) {
    this.conversations = new ConversationService(store, events)
    this.inbox = new ConversationInbox({
      key: (input) => {
        return this.batchKey(input)
      },
      create: (input) => {
        const messageId = input.identities[0]?.messageIds[0]
        if (!messageId) {
          throw new Error('合批输入缺少来源消息')
        }
        const part = {
          messageId,
          text: input.text,
          actorId: input.actorId,
          actorName: input.actorName,
          receivedAt: input.receivedAt,
          attachments: input.attachments ?? [],
          quote: input.quote
        }
        return this.prepareExecution({ ...input, parts: [part] }, 'batching')
      },
      append: (execution, input) => {
        this.appendBatch(execution, input)
      },
      dispatch: (execution) => {
        execution.run.status = 'queued'
        this.update(execution.run)
        this.queueExecution(execution)
      }
    })
  }

  ensureMockRoom() {
    if (this.store.listRooms().length > 0) {
      return
    }
    this.createMockRoom('开发测试群', 'group')
  }

  attachScheduler(scheduler: Scheduler) {
    this.scheduler = scheduler
  }
  attachMedia(media: MediaService) {
    this.media = media
    this.delivery.validateAccess = (roomId, access) => {
      assertArtifactDeliveryAccess(this.configuration(), access, (id) => {
        return media.require(roomId, id)
      })
    }
    this.delivery.validateReadAccess = (roomId, access) => {
      assertArtifactAccess(this.configuration(), access, (id) => {
        return media.require(roomId, id)
      })
    }
  }

  pluginMedia(room: Room) {
    const media = this.media
    if (!media) {
      return undefined
    }
    return {
      content(reference: Pick<ImageReference, 'source' | 'id'>, signal: AbortSignal) {
        return media.content(room, reference, signal)
      },
      require(id: string) {
        return media.require(room.id, id)
      }
    }
  }

  attachDurable(runtime: DurableAgentRuntime) {
    this.durable = runtime
    this.snapshots = new ConfigurationSnapshots(this.configuration)
    this.observations = new PluginObservations(this, runtime)
    if (this.plugins) {
      this.plugins.observePoint = (invocation, point, id, value) => {
        const event = this.observations!.create(
          invocation.config,
          invocation.room,
          invocation.input,
          point,
          id,
          value,
          invocation.origin
        )
        if (!event) {
          return undefined
        }
        this.store.saveObservation(event)
        this.observations!.wake()
        return event.id
      }
    }
  }
  attachJobs(jobs: JobService) {
    this.jobs = jobs
  }
  validateRender(outbound: Outbound) {
    const admission = outbound.renderAdmission
    const render = outbound.render
    if (!admission || !render || outbound.cancelRequested) {
      throw new Error('呈现已停止或缺少快照')
    }
    assertArtifactDeliveryAccess(this.configuration(), render.access, (id) => {
      if (!this.media) {
        throw new Error('媒体服务不可用')
      }
      return this.media.require(outbound.roomId, id)
    })
    for (const capability of [
      render.capability,
      ...render.access.capabilities,
      ...outbound.presentationHandlers
    ]) {
      this.authorizeRetainedContext(outbound.roomId, admission.mode, admission.input.context, capability)
    }
  }

  async prepareRecovery() {
    for (const run of this.store.recoverableRuns()) {
      try {
        if (!run.input || !run.context || !run.configSnapshot) {
          throw new Error('任务缺少恢复快照')
        }
        const room = { ...this.requireRoom(run.roomId), mode: run.mode }
        this.assertRoomEnabled(room)
        const config = await this.snapshots.load(run.configSnapshot)
        const input = freezeSnapshot({ ...run.input, context: run.context })
        if (
          !run.startedAt &&
          Date.now() - run.createdAt > input.context.effective.settings.behavior.queueMaxAgeMs
        ) {
          throw new Error('排队请求已过期，未自动补发旧回答')
        }
        const controller = new AbortController()
        const host = this.executionHost(config, room, input, run, controller)
        host.tools.assertActive?.()
        const callbacks = runObserver(
          run,
          this.events,
          () => {
            this.update(run)
          },
          (event) => {
            this.trace(run, event)
          }
        )
        this.durable.prepare(
          run.id,
          config,
          room,
          input,
          controller.signal,
          host.tools,
          callbacks,
          run.modelCalls
        )
        this.active.set(run.id, {
          roomId: room.id,
          run,
          controller,
          completion: Promise.withResolvers<Run>()
        })
        this.recovery.push({ config, room, input, run, controller })
      } catch (error) {
        run.status = 'failed'
        run.error = this.configuration().catalog.redact(String(error))
        run.finishedAt = Date.now()
        this.update(run)
      }
    }
  }

  resumeRecovery() {
    this.observations?.start()
    for (const item of this.recovery.splice(0)) {
      this.queueExecution(item)
    }
    void this.recoverInbound(true)
    void this.recoverPresentations()
  }

  private async recoverPresentations() {
    for (const room of this.store.listRooms()) {
      for (const outbound of this.store.pendingPresentations(room.id)) {
        if (outbound.inlineRender) {
          let stage: 'presentation' | 'transport' = 'presentation'
          let inline = outbound.inlineRender
          if (outbound.state === 'sending') {
            stage = 'transport'
          }
          if (inline === 'started' || inline === 'planned') {
            inline = 'unknown'
          }
          this.store.saveOutbound({
            ...outbound,
            inlineRender: inline,
            state: 'unknown',
            uncertaintyStage: stage,
            error: '短时工具呈现或发送被进程中断，未自动重新合成或发送'
          })
          continue
        }
        if (outbound.state !== 'rendering' && !(outbound.state === 'prepared' && outbound.renderFallback)) {
          continue
        }
        try {
          if (!this.jobs) {
            continue
          }
          await this.delivery.send(room, outbound.text, outbound.runId, outbound.role, outbound.id, {
            artifactIds: outbound.requestedArtifactIds,
            authorize: (capability) => {
              const admission = outbound.renderAdmission!
              this.authorizeRetainedContext(room.id, admission.mode, admission.input.context, capability)
            },
            beforePart: () => {
              this.validateRender(this.store.getOutbound(outbound.id)!)
            },
            presentation: {
              key: outbound.presentationKey ?? '',
              enqueue: (outbound) => {
                return this.jobs!.present(outbound)
              },
              validateRender: (outbound) => {
                this.validateRender(outbound)
              },
              validate: () => {
                this.validateRender(this.store.getOutbound(outbound.id)!)
              },
              async prepare() {
                throw new Error('恢复仅复用原呈现决定')
              }
            }
          })
          const run = outbound.runId && this.store.getRun(outbound.runId)
          if (run) {
            run.presentation = { state: 'sent' }
            this.update(run)
          }
        } catch {
          const latest = this.store.getOutbound(outbound.id)
          if (latest?.state === 'rendering') {
            try {
              this.validateRender(latest)
              continue
            } catch {
              /* A current denial retires the intent. */
            }
            this.store.saveOutbound({
              ...latest,
              state: 'suppressed',
              error: '呈现接纳恢复未获授权，未重选或发送'
            })
          }
        }
      }
    }
  }

  createMockRoom(name: string, kind: 'group' | 'direct') {
    const id = crypto.randomUUID()
    const room = RoomSchema.parse({
      id,
      name,
      address: { channel: 'mock', accountId: 'mock-bot', kind, chatId: id },
      mode: 'demo',
      createdAt: Date.now(),
      updatedAt: Date.now()
    })
    this.conversations.create(room, '初始对话')
    return this.requireRoom(room.id)
  }

  async receive(
    roomId: string,
    text: string,
    actorId = 'developer',
    actorName = '开发者',
    mediaIds: readonly string[] = [],
    replyTo?: ReplyReference
  ) {
    if (this.closing) {
      throw new Error('服务正在关闭，请稍后重试')
    }
    const room = this.requireRoom(roomId)
    this.assertRoomEnabled(room)
    const id = crypto.randomUUID()
    const attachments = mediaIds.map((mediaId) => {
      if (!this.media) {
        throw new Error('媒体服务未配置')
      }
      const record = this.media.require(room.id, mediaId)
      if (!record.messageId) {
        this.store.saveMedia({ ...record, messageId: id })
      }
      return this.media.attachment(record)
    })
    if (replyTo?.messageId && this.store.getMessage(replyTo.messageId)?.roomId !== roomId) {
      throw new Error('引用不属于当前会话')
    }
    const message: ChatMessage = {
      id,
      roomId,
      role: 'user',
      actorId,
      actorName,
      text,
      attachments,
      replyTo,
      createdAt: Date.now(),
      platformMessageIds: [],
      conversationId: room.currentConversationId,
      recalled: false
    }
    const identity = {
      ...localIdentity(room.address.channel, room.address.accountId, actorId, actorName),
      messageIds: [message.id]
    }
    const control = this.prepareInbound(room, message, text, identity)
    this.store.saveMessage(message, this.messageObservation(message, identity))
    this.observations?.wake()
    this.events.emit({ type: 'message', message })
    return this.dispatchInbound(room, message, control)
  }

  async receiveIncoming(
    roomId: string,
    incoming: IncomingMessage,
    prompt: string | null
  ): Promise<InboundOutcome> {
    if (this.closing) {
      throw new Error('服务正在关闭')
    }
    const room = this.requireRoom(roomId)
    this.assertRoomEnabled(room)
    if (addressKey(room.address) !== addressKey(incoming.address)) {
      throw new Error('消息来源与聊天范围不匹配')
    }
    const existing = this.store.findPlatformMessage(room.id, incoming.externalId)
    if (existing) {
      if (existing.inbound?.state === 'unknown') {
        return 'uncertain'
      }
      if (existing.inbound?.state === 'pending') {
        return this.acceptInbound(room, existing)
      }
      return 'duplicate'
    }
    let role: ChatMessage['role'] = 'user'
    if (incoming.isSelf) {
      role = 'assistant'
    }
    const id = crypto.randomUUID()
    const message: ChatMessage = {
      id,
      roomId,
      role,
      actorId: incoming.actorId,
      actorName: incoming.actorName,
      text: incoming.text,
      attachments: incoming.attachments.flatMap((attachment) => {
        if (this.media) {
          return [this.media.capture(room, id, attachment)]
        }
        return []
      }),
      replyTo: incoming.replyTo,
      createdAt: incoming.receivedAt,
      platformMessageIds: [incoming.externalId],
      conversationId: room.currentConversationId,
      recalled: this.store.wasRecalled(room.id, incoming.externalId)
    }
    const identity: TriggerIdentity = Object.freeze({
      origin: 'platform',
      actorId: incoming.actorId,
      actorName: incoming.actorName,
      channel: incoming.address.channel,
      accountId: incoming.address.accountId,
      role: incoming.platformRole,
      messageIds: [message.id]
    })
    if (!incoming.isSelf && !message.recalled && prompt === null) {
      const candidate = extractPrompt(
        incoming.text,
        this.configuration().bot.onebot.commandPrefix,
        incoming.address.accountId,
        (text) => {
          return Boolean(findPluginCommand(this.configuration(), this.effective(room.id).settings, text))
        }
      )
      if (candidate && findPluginCommand(this.configuration(), this.effective(room.id).settings, candidate)) {
        prompt = candidate
      }
    }
    let control = false
    if (!incoming.isSelf && !message.recalled && prompt !== null) {
      control = this.prepareInbound(room, message, prompt, identity)
    }
    let observation: ReturnType<PluginObservations['create']>
    if (!incoming.isSelf) {
      observation = this.messageObservation(message, identity)
    }
    this.store.saveMessage(message, observation)
    this.observations?.wake()
    this.events.emit({ type: 'message', message })
    if (incoming.isSelf) {
      return 'self'
    }
    if (message.recalled) {
      return 'recorded'
    }
    if (!message.inbound) {
      return 'recorded'
    }
    return this.acceptInbound(room, message, control)
  }

  private prepareInbound(room: Room, message: ChatMessage, prompt: string, identity: TriggerIdentity) {
    if (isControlCommand(prompt)) {
      if (this.controlDispatches >= 16) {
        throw new Error('控制指令正忙，请稍后重试')
      }
      message.inbound = {
        state: 'dispatching',
        control: true,
        prompt,
        identity,
        epoch: room.conversationEpoch,
        expiresAt: Date.now() + this.effective(room.id).settings.behavior.timeoutMs
      }
      return true
    }
    const limit = this.configuration().bot.agent.maxQueuedRuns
    const pending = this.store.pendingInbound(limit + 1, true)
    for (const item of pending) {
      if (item.inbound?.state === 'pending' && item.inbound.expiresAt <= Date.now()) {
        this.finishInbound(item, { state: 'expired', error: '受理等待已过期，未自动执行旧输入' })
      }
    }
    if (this.store.pendingInbound(limit, true).length >= limit) {
      throw new Error('入站受理队列已满，请稍后重试')
    }
    message.inbound = {
      state: 'pending',
      control: false,
      prompt,
      identity,
      epoch: room.conversationEpoch,
      expiresAt: Date.now() + this.effective(room.id).settings.behavior.queueMaxAgeMs
    }
    return false
  }

  private finishInbound(message: ChatMessage, inbound: NonNullable<ChatMessage['inbound']>) {
    const updated = { ...(this.store.getMessage(message.id) ?? message), inbound }
    this.store.saveMessage(updated)
    this.events.emit({ type: 'message', message: updated })
  }

  private async acceptInbound(room: Room, message: ChatMessage, control = false): Promise<InboundOutcome> {
    await this.dispatchInbound(room, message, control)
    const state = this.store.getMessage(message.id)?.inbound
    if (state?.state === 'unknown') {
      return 'uncertain'
    }
    if (state?.state === 'accepted') {
      return state.outcome
    }
    return 'recorded'
  }

  private async dispatchInbound(room: Room, message: ChatMessage, control = false) {
    if (this.closing) {
      throw new Error('服务正在关闭')
    }
    this.assertRoomEnabled(room)
    message = this.store.getMessage(message.id) ?? message
    const admission = message.inbound
    const claimedControl = control && admission?.state === 'dispatching' && admission.control
    if (admission?.state !== 'pending' && !claimedControl) {
      return null
    }
    if (admission.state !== 'pending' && admission.state !== 'dispatching') {
      return null
    }
    if (
      admission.expiresAt <= Date.now() ||
      admission.epoch !== room.conversationEpoch ||
      message.conversationId !== room.currentConversationId ||
      message.recalled
    ) {
      this.finishInbound(message, { state: 'expired', error: '输入已过期、撤回或所属对话已变化，未自动执行' })
      return null
    }
    if (claimedControl) {
      this.controlDispatches += 1
    }
    try {
      const run = await this.processInput(
        room,
        admission.prompt,
        admission.identity,
        message.createdAt,
        message
      )
      if (!run) {
        this.finishInbound(message, { state: 'accepted', outcome: 'command' })
      }
      return run
    } catch (error) {
      if (this.store.getMessage(message.id)?.inbound?.state === 'dispatching') {
        this.finishInbound(message, {
          state: 'unknown',
          error: '直接指令执行或交付未完成，未自动重做；请核对实际结果'
        })
      }
      throw error
    } finally {
      if (claimedControl) {
        this.controlDispatches -= 1
      }
    }
  }

  private async recoverInbound(startup = false) {
    if (this.recoveringInbound || this.closing) {
      return
    }
    this.recoveringInbound = true
    try {
      let limit = this.configuration().bot.agent.maxQueuedRuns
      if (startup) {
        limit += 16
      }
      for (const message of this.store.pendingInbound(limit, !startup)) {
        if (message.inbound?.state === 'dispatching') {
          if (startup) {
            this.finishInbound(message, {
              state: 'unknown',
              error: '服务在直接指令期间中断，未自动重做；请核对实际结果'
            })
          }
          continue
        }
        try {
          await this.dispatchInbound(this.requireRoom(message.roomId), message)
        } catch {
          // Capacity and disabled rooms stay pending until a retry, completion or restart.
        }
      }
    } finally {
      this.recoveringInbound = false
    }
  }

  syncOneBotRooms() {
    const config = this.configuration()
    for (const target of config.bot.onebot.targets) {
      if (!target.enabled) {
        continue
      }
      const address = {
        channel: 'onebot-v11',
        accountId: target.selfId,
        kind: 'group' as const,
        chatId: target.chatId
      }
      if (
        this.store.listRooms().some((room) => {
          return addressKey(room.address) === addressKey(address)
        })
      ) {
        continue
      }
      const room = RoomSchema.parse({
        id: crypto.randomUUID(),
        name: target.name,
        address,
        mode: 'live',
        createdAt: Date.now(),
        updatedAt: Date.now()
      })
      this.conversations.create(room, '初始对话')
    }
    for (const room of this.store.listRooms()) {
      if (room.address.channel === 'onebot-v11' && !oneBotAllowed(config.bot.onebot, room.address)) {
        this.stop(room.id)
      }
    }
  }
  receiveRecall(address: Room['address'], platformId: string) {
    const room = this.store.listRooms().find((room) => {
      return addressKey(room.address) === addressKey(address)
    })
    if (!room) {
      return
    }
    const message = this.store.recordRecall(room.id, platformId)
    if (message) {
      this.events.emit({ type: 'message', message })
    }
  }

  private assertRoomEnabled(room: Room) {
    if (
      room.address.channel === 'onebot-v11' &&
      !oneBotAllowed(this.configuration().bot.onebot, room.address)
    ) {
      throw new Error('该 QQ 会话已停用，请在 QQ 接入中启用对应测试群')
    }
  }

  private async processInput(
    room: Room,
    text: string,
    identity: TriggerIdentity,
    receivedAt: number,
    message?: ChatMessage
  ) {
    const beginDispatch = () => {
      if (message?.inbound?.state === 'pending') {
        this.finishInbound(message, { ...message.inbound, state: 'dispatching' })
      }
    }
    const roomId = room.id
    if (isJobCommand(text)) {
      beginDispatch()
      let response = '后台任务运行时尚未启用。'
      if (this.jobs) {
        try {
          response = await executeJobCommand(this.jobs, this.jobInvocation(roomId, identity, text), text)
        } catch (error) {
          response = this.configuration().catalog.redact(String(error))
        }
      }
      await this.delivery.send(room, response, undefined, 'system')
      return null
    }
    const effective = this.effective(room.id)
    const authority = captureAuthority(
      effective,
      [identity],
      undefined,
      this.configuration().resources.capabilityIds(effective.settings)
    )
    const skill = requestedSkill(text)
    if (text.trim() === '/skills') {
      beginDispatch()
      const available = this.configuration()
        .resources.skills(effective.settings)
        .filter((manifest) => {
          return authority.capabilities.includes(skillCapabilityId(manifest.id))
        })
      const lines = available.map((manifest) => {
        return `${manifest.id} · ${manifest.name}`
      })
      lines.push('用法：/skill ID 任务内容')
      await this.delivery.send(room, lines.join('\n'), undefined, 'system')
      return null
    }
    if (skill && !authority.capabilities.includes(skillCapabilityId(skill))) {
      beginDispatch()
      await this.delivery.send(
        room,
        '此 Skill 未启用、尚未导入或当前触发来源无权使用。可用 /skills 查看。',
        undefined,
        'system'
      )
      return null
    }
    if (text.trim() === '/stop') {
      beginDispatch()
      assertCapability(authority, effective.settings, 'command:stop')
      const count = this.stop(roomId)
      await this.delivery.send(
        room,
        `已请求停止当前会话的前后台工作（当前 ${count} 个 Agent 执行）。`,
        undefined,
        'system'
      )
      return null
    }
    if (text.trim() === '/new') {
      beginDispatch()
      assertCapability(authority, effective.settings, 'command:new')
      this.newConversation(roomId)
      await this.delivery.send(
        this.requireRoom(roomId),
        '已开启新的共享对话，聊天记录与工作区文件仍保留。',
        undefined,
        'system'
      )
      return null
    }
    if (text.trim() === '/status' || text.trim() === '/help') {
      beginDispatch()
      let pluginHelp = ''
      if (this.plugins?.available()) {
        pluginHelp = pluginCommandHelp(this.configuration(), effective.settings, authority.capabilities)
      }
      const execution = executionStatus(this.configuration().bot.agent.execution)
      const status = `会话：${room.name}\n当前对话：${room.currentConversationId}\n人格：${effective.persona.name}\n模式：${room.mode}\n模型组：${effective.settings.preferences.providerGroup}\n执行环境：${execution.message}\n\n/help 查看帮助\n/stop 停止任务\n/new 新建共享对话\n/status 查看状态\n${this.configuration().bot.onebot.commandPrefix} 内容：触发 Agent。普通 QQ 消息只同步到会话。`
      await this.delivery.send(
        room,
        status + '\n/skills 查看可用技能\n/skill ID 内容：显式使用技能\n' + jobCommandHelp + pluginHelp,
        undefined,
        'system'
      )
      return null
    }
    const pluginCommand = findPluginCommand(this.configuration(), effective.settings, text)
    if (pluginCommand) {
      beginDispatch()
      const invocation = this.jobInvocation(roomId, identity, text)
      let commandSignal = new AbortController().signal
      const services: HostToolServices = {
        media: this.pluginMedia(room) && {
          ...this.pluginMedia(room)!,
          preview: async () => {
            throw new Error('指令不提供图片预览')
          },
          visionEnabled: false
        },
        authorize: (capability) => {
          commandSignal.throwIfAborted()
          invocation.authorize(capability)
        },
        history: (limit) => {
          return projectHistory(this.store.listMessages(roomId, limit), effective.settings)
        },
        send: (value, callId, artifactIds, beforePart) => {
          commandSignal.throwIfAborted()
          invocation.authorize('chat_send')
          return this.delivery.send(
            room,
            value,
            undefined,
            'assistant',
            'plugin-command:' + invocation.runId + ':' + callId,
            {
              artifactIds,
              authorize: services.authorize,
              presentation: this.presentation(
                invocation.config,
                room,
                invocation.input,
                'plugin-command:' + invocation.runId + ':' + callId,
                'tool-direct',
                commandSignal
              ),
              beforePart: () => {
                commandSignal.throwIfAborted()
                beforePart?.()
                invocation.authorize('chat_send')
              }
            }
          )
        }
      }
      try {
        if (!this.plugins) {
          throw new Error('插件执行后端未启用')
        }
        const plugins = this.plugins
        await plugins.scoped(
          roomId,
          pluginCommand.binding.instance.id,
          AbortSignal.timeout(effective.settings.behavior.timeoutMs),
          async (signal) => {
            commandSignal = signal
            const result = await executePluginCommand(
              plugins,
              { ...invocation, services },
              { ...invocation, authorize: services.authorize },
              this.jobs,
              pluginCommand,
              signal
            )
            services.authorize(pluginCommand.capabilityId)
            await this.delivery.send(
              room,
              result.summary,
              undefined,
              'assistant',
              'plugin-command:' + invocation.runId + ':result',
              {
                artifactIds: result.artifactIds.slice(0, 8),
                authorize: services.authorize,
                presentation: this.presentation(
                  invocation.config,
                  room,
                  invocation.input,
                  'plugin-command:' + invocation.runId + ':result',
                  'final',
                  signal
                ),
                beforePart: () => {
                  services.authorize(pluginCommand.capabilityId)
                  services.authorize(
                    pluginOperationId(pluginCommand.binding.instance.id, pluginCommand.command.operation)
                  )
                }
              }
            )
          }
        )
      } catch (error) {
        if (error instanceof DeliverySuppressed) {
          return null
        }
        await this.delivery
          .send(
            room,
            this.publicError(error),
            undefined,
            'system',
            'plugin-command:' + invocation.runId + ':error',
            {
              beforePart: () => {
                this.checkContext(room.id, room.mode, invocation.input.context)
              }
            }
          )
          .catch(() => {})
      }
      return null
    }
    let source: Run['source'] = 'im'
    if (text.startsWith('/')) {
      source = 'command'
    }
    if (!effective.settings.behavior.agentEnabled) {
      beginDispatch()
      await this.delivery.send(room, '此聊天范围已关闭 Agent，仍可使用指令和查看历史。', undefined, 'system')
      return null
    }
    const input: RunInput = {
      roomId,
      text,
      actorId: identity.actorId,
      actorName: identity.actorName,
      source,
      receivedAt,
      identities: [identity],
      ...this.messageContext(room.id, identity.messageIds[0])
    }
    if (source === 'im' && effective.settings.behavior.batchQuietMs > 0) {
      return this.inbox.accept(input, effective.settings.behavior)
    }
    return this.enqueue(input)
  }
  private messageContext(roomId: string, messageId?: string) {
    const message = this.store.getMessage(messageId ?? '')
    if (!message || message.roomId !== roomId) {
      return {}
    }
    let quote: QuoteContext | undefined
    if (message.replyTo) {
      let reference = this.store.getMessage(message.replyTo.messageId ?? '')
      if (!reference && message.replyTo.platformMessageId) {
        reference = this.store.findPlatformMessage(roomId, message.replyTo.platformMessageId)
      }
      if (reference?.roomId === roomId) {
        quote = quoteContext(reference)
      } else {
        quote = { state: 'not_observed', ...message.replyTo, attachments: [] }
      }
    }
    return { attachments: attachmentReferences(roomId, message.attachments), quote }
  }

  enqueue(input: RunInput) {
    const execution = this.prepareExecution(input, 'queued')
    this.queueExecution(execution)
    return execution.run
  }

  private prepareExecution(input: RunInput, status: 'queued' | 'batching'): QueuedExecution {
    if (this.closing) {
      throw new Error('服务正在关闭，请稍后重试')
    }
    const config = this.configuration()
    if (this.active.size >= config.bot.agent.maxQueuedRuns) {
      throw new Error('任务队列已满，请稍后重试。')
    }
    const room = structuredClone(this.requireRoom(input.roomId))
    this.assertRoomEnabled(room)
    const conversation = this.conversations.require(
      input.conversationId ?? room.currentConversationId,
      room.id
    )
    const effective = this.effective(room.id, conversation.id)
    if (!effective.settings.behavior.agentEnabled) {
      throw new Error('当前聊天范围已关闭 Agent')
    }
    const authority = captureAuthority(
      effective,
      input.inheritedAuthority?.identities ?? input.identities,
      input.inheritedAuthority?.capabilities,
      config.resources.capabilityIds(effective.settings)
    )
    let workspaceScope = room.id
    if (conversation.kind !== 'root') {
      workspaceScope = room.id + ':conversation:' + conversation.id
    }
    if (input.workspaceScope) {
      workspaceScope = input.workspaceScope
    }
    const prepared: PreparedRunInput = freezeSnapshot(
      structuredClone({
        ...input,
        context: {
          conversationId: conversation.id,
          rootConversationId: room.currentConversationId,
          conversationEpoch: room.conversationEpoch,
          sessionKey: conversation.sessionKey,
          workspaceScope,
          capabilityRevisions: config.resources.capabilityRevisions(effective.settings),
          effective,
          authority
        }
      })
    )
    const run: Run = {
      id: crypto.randomUUID(),
      roomId: room.id,
      source: input.source,
      input,
      mode: room.mode,
      status,
      providerGroup: effective.settings.preferences.providerGroup,
      context: prepared.context,
      createdAt: Date.now(),
      modelCalls: 0,
      toolCalls: 0,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
    }
    run.configSnapshot = this.snapshots.save(config)
    const controller = new AbortController()
    this.linkMessages(run)
    this.active.set(run.id, { roomId: room.id, controller, run, completion: Promise.withResolvers<Run>() })
    this.events.emit({ type: 'run', run })
    this.trace(run, { kind: 'queued', title: '任务已排队', detail: input.source })
    return { config, room, input: prepared, run, controller }
  }

  private batchKey(input: RunInput) {
    const room = this.requireRoom(input.roomId)
    const config = this.configuration()
    const effective = this.effective(room.id)
    const configuration = this.snapshots.save(config)
    return [
      room.id,
      room.currentConversationId,
      room.conversationEpoch,
      room.mode,
      effective.revision,
      configuration
    ].join(':')
  }

  private appendBatch(execution: QueuedExecution, incoming: RunInput) {
    const messageId = incoming.identities[0]?.messageIds[0]
    if (!messageId) {
      throw new Error('合批输入缺少来源消息')
    }
    const { context, ...previous } = execution.input
    const parts = [
      ...(previous.parts ?? []),
      {
        messageId,
        text: incoming.text,
        actorId: incoming.actorId,
        actorName: incoming.actorName,
        receivedAt: incoming.receivedAt,
        attachments: incoming.attachments ?? [],
        quote: incoming.quote
      }
    ]
    const identities = [...previous.identities, ...incoming.identities]
    const input: RunInput = freezeSnapshot({
      ...previous,
      parts,
      identities,
      text: parts
        .map((part) => {
          return part.text
        })
        .join('\n\n'),
      actorId: 'shared-scope',
      actorName: '群内合批'
    })
    const authority = captureAuthority(
      context.effective,
      identities,
      context.authority.capabilities,
      execution.config.resources.capabilityIds(context.effective.settings)
    )
    execution.input = freezeSnapshot({ ...input, context: { ...context, authority } })
    execution.run.input = input
    execution.run.context = execution.input.context
    this.linkMessages(execution.run)
    this.events.emit({ type: 'run', run: execution.run })
  }

  private linkMessages(run: Run) {
    const messages: ChatMessage[] = []
    for (const identity of run.input?.identities ?? []) {
      for (const id of identity.messageIds) {
        const message = this.store.getMessage(id)
        if (message?.roomId === run.roomId && message.role === 'user' && message.runId !== run.id) {
          const linked: ChatMessage = { ...message, runId: run.id }
          if (message.inbound?.state === 'pending') {
            linked.inbound = { state: 'accepted', outcome: 'agent' }
          }
          messages.push(linked)
        }
      }
    }
    this.store.saveRunAdmission(run, messages)
    for (const message of messages) {
      this.events.emit({ type: 'message', message })
    }
  }

  private queueExecution({ config, room, input, run, controller }: QueuedExecution) {
    let key = room.id
    if (input.context.conversationId !== input.context.rootConversationId) {
      key = room.id + ':background:' + input.context.conversationId
    }
    const previous = this.queues.get(key) ?? Promise.resolve()
    const task = previous
      .catch(() => {})
      .then(async () => {
        if (controller.signal.aborted) {
          return
        }
        if (
          !run.startedAt &&
          Date.now() - run.createdAt > input.context.effective.settings.behavior.queueMaxAgeMs
        ) {
          run.status = 'failed'
          run.error = '排队请求已过期，未自动补发旧回答'
          run.finishedAt = Date.now()
          this.update(run)
          return
        }
        await this.execute(config, room, input, run, controller)
      })
      .finally(async () => {
        await this.durable.abandon(run.id)
        this.active.get(run.id)?.completion.resolve(run)
        this.active.delete(run.id)
        if (this.queues.get(key) === task) {
          this.queues.delete(key)
        }
        void this.recoverInbound()
      })
    this.queues.set(key, task)
    void task.catch((error) => {
      console.error('Task bookkeeping failed:', config.catalog.redact(String(error)))
    })
  }

  private async execute(
    config: Configuration,
    room: Room,
    input: PreparedRunInput,
    run: Run,
    controller: AbortController
  ) {
    await executeRun(
      config,
      room,
      input,
      run,
      controller,
      this.executionHost(config, room, input, run, controller)
    )
  }

  private executionHost(
    config: Configuration,
    room: Room,
    input: PreparedRunInput,
    run: Run,
    controller: AbortController
  ) {
    const assertCurrent = () => {
      this.checkContext(room.id, room.mode, input.context)
    }
    const assertActive = () => {
      controller.signal.throwIfAborted()
      assertCurrent()
      if (run.deadlineAt !== undefined && Date.now() >= run.deadlineAt) {
        controller.abort(new Error('任务执行期限已到'))
        controller.signal.throwIfAborted()
      }
    }
    const deliver = async (text: string, role: 'assistant' | 'system' = 'assistant') => {
      const validate = () => {
        if (role === 'assistant') {
          assertActive()
          return
        }
        // Failure notices can explain a timeout, but cannot outlive stop/shutdown or their scope.
        assertCurrent()
        if (controller.signal.reason === 'user' || controller.signal.reason === 'shutdown') {
          controller.signal.throwIfAborted()
        }
      }
      validate()
      return this.delivery.send(room, text, run.id, role, `run:${run.id}:${role}`, {
        beforePart: validate,
        presentation:
          (role === 'assistant' &&
            this.presentation(
              config,
              room,
              input,
              `run:${run.id}:${role}`,
              'final',
              controller.signal,
              undefined,
              'agent-final',
              true
            )) ||
          undefined
      })
    }
    const tools: HostToolServices = {
      plugins: this.plugins,
      assertActive,
      present: async (text, callId, artifactIds) => {
        const authorize = (capability: string) => {
          assertActive()
          this.authorizeContext(room.id, room.mode, input.context, capability)
        }
        authorize('chat_present')
        authorize('chat_send')
        const id = `run:${run.id}:present:${callId}`
        try {
          const message = await this.delivery.send(
            room,
            projectOutput(text, input.context.effective.settings),
            run.id,
            'assistant',
            id,
            {
              artifactIds,
              authorize,
              beforePart: () => {
                authorize('chat_present')
                authorize('chat_send')
              },
              presentation: this.presentation(
                config,
                room,
                input,
                id,
                'tool-direct',
                controller.signal,
                'tool',
                'agent-tool',
                true
              )
            }
          )
          return { delivered: true, messageId: message.id }
        } catch (error) {
          if (error instanceof DeliveryDeferred) {
            return { delivered: false, jobId: error.jobId }
          }
          if (error instanceof DeliveryAdmissionUnknown) {
            return { delivered: false, admissionUnknown: true, outboundId: error.outboundId }
          }
          throw error
        }
      },
      history: (limit) => {
        return projectHistory(this.store.listMessages(room.id, limit), input.context.effective.settings)
      },
      send: (text, callId, artifactIds, beforePart, lifetime) => {
        assertActive()
        const signals = [controller.signal]
        if (lifetime) {
          signals.push(lifetime.signal)
        }
        const signal = AbortSignal.any(signals)
        const remaining = Math.max(
          0,
          Math.min(run.deadlineAt ?? Infinity, lifetime?.deadlineAt ?? Infinity) - Date.now()
        )
        const renderDeadline = Date.now() + Math.min(10000, remaining * 0.75)
        return this.delivery.send(
          room,
          projectOutput(text, input.context.effective.settings),
          run.id,
          'assistant',
          `run:${run.id}:tool:${callId}`,
          {
            artifactIds,
            authorize: (capability) => {
              assertActive()
              this.authorizeContext(room.id, room.mode, input.context, capability)
            },
            presentation: this.presentation(
              config,
              room,
              input,
              `run:${run.id}:tool:${callId}`,
              'tool-direct',
              signal,
              'tool',
              'agent-tool',
              false,
              renderDeadline
            ),
            beforePart: () => {
              assertActive()
              signal.throwIfAborted()
              beforePart?.()
              this.authorizeContext(room.id, room.mode, input.context, 'chat_send')
            }
          }
        )
      },
      authorize: (capability) => {
        assertActive()
        this.authorizeContext(room.id, room.mode, input.context, capability)
      },
      schedules: this.scheduleServices(room, input),
      jobs: this.jobs?.forInvocation({
        config,
        room,
        input,
        runId: run.id,
        authorize: (capability) => {
          assertActive()
          this.authorizeContext(room.id, room.mode, input.context, capability)
        }
      })
    }
    const supportsImages =
      room.mode === 'live' &&
      config.catalog
        .forGroup(input.context.effective.settings.preferences.providerGroup)
        .some((candidate) => {
          return candidate.config.images
        })
    tools.projectContext = createMediaProjection(
      this.media,
      room,
      input,
      controller.signal,
      tools.authorize,
      supportsImages,
      (facts) => {
        this.trace(run, {
          kind: 'media',
          title: `本次请求投影 ${facts.images} 张图片`,
          detail: `图片引用 ${facts.referenced} 项；图片编码 ${facts.bytes} 字节；最长边预算 ${input.context.effective.settings.data.imageMaxSide} 像素。历史不重复载入像素。`
        })
      }
    )
    if (this.media) {
      const media = this.media
      const policy = input.context.effective.settings.data
      tools.media = {
        require(id) {
          return media.require(room.id, id)
        },
        content(reference, signal) {
          return media.content(room, reference, signal)
        },
        preview(reference, signal) {
          return media.preview(
            room,
            reference,
            policy.imageMaxSide,
            Math.min(1024 * 1024, policy.imageBudgetBytes),
            signal
          )
        },
        visionEnabled: policy.visionEnabled && supportsImages
      }
    }
    return {
      events: this.events,
      deliver,
      update: (run: Run) => {
        this.update(run)
      },
      trace: (run: Run, trace: Omit<Trace, 'id' | 'at' | 'runId' | 'roomId'>) => {
        this.trace(run, trace)
      },
      tools,
      invoke: (callbacks: import('@pi-im-bot/agent/events').AgentCallbacks) => {
        this.durable.prepare(run.id, config, room, input, controller.signal, tools, callbacks, run.modelCalls)
        return this.durable.run(run.id, config, room, input, controller.signal, tools, callbacks)
      }
    }
  }

  stop(roomId: string) {
    for (const outbound of this.store.pendingPresentations(roomId)) {
      if (outbound.render && ['rendering', 'prepared', 'sending'].includes(outbound.state)) {
        let state = outbound.state
        if (state !== 'sending') {
          state = 'cancelled'
        }
        this.store.saveOutbound({ ...outbound, state, cancelRequested: true })
      }
    }
    const entries = [...this.active.values()].filter((entry) => {
      return entry.roomId === roomId && ['batching', 'queued', 'running'].includes(entry.run.status)
    })
    const cancelled = this.store.cancelPendingInbound(roomId)
    for (const message of cancelled) {
      this.events.emit({ type: 'message', message })
    }
    this.plugins?.cancelScope(roomId)
    if (this.jobs) {
      const cancellation = this.jobs
        .cancelScope(roomId)
        .catch((error) => {
          console.warn('Job cancellation:', this.configuration().catalog.redact(String(error)))
        })
        .finally(() => {
          this.jobCancellations.delete(cancellation)
        })
      this.jobCancellations.add(cancellation)
    }
    this.inbox.discard(roomId)
    let count = 0
    for (const entry of entries) {
      entry.controller.abort('user')
      const batching = entry.run.status === 'batching'
      entry.run.status = 'cancelled'
      entry.run.finishedAt = Date.now()
      entry.run.error = 'user'
      this.update(entry.run)
      if (batching) {
        entry.completion.resolve(entry.run)
        this.active.delete(entry.run.id)
      }
      count += 1
    }
    return count
  }

  private scheduleServices(room: Room, input: PreparedRunInput): ScheduleToolServices | undefined {
    const scheduler = this.scheduler
    if (!scheduler) {
      return undefined
    }
    return {
      create(schedule) {
        return scheduler.save(
          { ...schedule, roomId: room.id, enabled: true, isolated: true },
          input.context.authority
        )
      },
      list: () => {
        return this.store.listSchedules().filter((schedule) => {
          return schedule.roomId === room.id
        })
      },
      remove: async (id) => {
        const schedule = this.store.listSchedules().find((item) => {
          return item.id === id && item.roomId === room.id
        })
        if (!schedule) {
          throw new Error('当前会话中不存在该计划任务')
        }
        await scheduler.remove(id)
      }
    }
  }

  async shutdown() {
    this.closing = true
    this.inbox.close()
    this.observations?.close()
    for (const room of this.store.listRooms()) {
      this.plugins?.cancelScope(room.id)
    }
    for (const entry of this.active.values()) {
      entry.controller.abort('shutdown')
      if (entry.run.status === 'batching') {
        entry.run.status = 'interrupted'
        entry.run.error = 'shutdown'
        this.update(entry.run)
      }
    }
    await Promise.allSettled(this.jobCancellations)
    await this.durable.close()
    await Promise.allSettled(this.queues.values())
  }

  requireRoom(id: string) {
    const room = this.store.getRoom(id)
    if (!room) {
      throw new Error('会话不存在')
    }
    return room
  }

  checkContext(roomId: string, mode: Room['mode'], context: ExecutionContext) {
    const current = this.requireRoom(roomId)
    this.assertRoomEnabled(current)
    if (current.conversationEpoch !== context.conversationEpoch) {
      throw new Error('当前对话已切换，旧任务不可继续操作')
    }
    if (current.mode !== mode) {
      throw new Error('会话模式已切换，旧任务不可继续操作')
    }
    if (context.schedule) {
      const schedule = this.store.listSchedules().find((schedule) => {
        return schedule.id === context.schedule?.id
      })
      if (!schedule || schedule.executionEpoch !== context.schedule.epoch) {
        throw new Error('计划工作已停止或移除')
      }
    }
  }

  authorizeContext(roomId: string, mode: Room['mode'], context: ExecutionContext, capability: string) {
    this.checkContext(roomId, mode, context)
    const effective = this.effective(roomId, context.conversationId)
    if (!this.configuration().resources.capabilityIds(effective.settings).includes(capability)) {
      throw new Error(`能力已停用或配置已变化：${capability}`)
    }
    if (
      ['read', 'write', 'edit', 'ls', 'bash'].includes(capability) &&
      this.configuration().bot.agent.execution.backend !== 'shipyard'
    ) {
      throw new Error('沙盒执行已停用')
    }
    assertCapability(context.authority, effective.settings, capability)
  }
  authorizeExternalContext(
    roomId: string,
    mode: Room['mode'],
    context: ExecutionContext,
    capability: string,
    serverId: string
  ) {
    this.checkContext(roomId, mode, context)
    const effective = this.effective(roomId, context.conversationId)
    assertCapability(context.authority, effective.settings, capability)
    const server = this.configuration().resources.config.mcp.find((server) => {
      return server.id === serverId
    })
    const selected = effective.settings.resources.mcp
    if (!server?.enabled || (selected.mode === 'selected' && !selected.ids.includes(serverId))) {
      throw new Error('此 MCP 服务已停用或从当前范围移除')
    }
  }
  presentation(
    config: Configuration,
    room: Room,
    input: PreparedRunInput,
    id: string,
    phase: DeliveryPhase,
    signal: AbortSignal,
    origin?: PluginInvocation['origin'],
    producer: DeliveryView['producer'] = 'unknown',
    deferred = false,
    inlineDeadlineAt?: number
  ) {
    const presentation = pluginPresentation(
      this.plugins,
      {
        config,
        room,
        input,
        origin,
        services: {
          media: this.pluginMedia(room),
          authorize: (capability) => {
            signal.throwIfAborted()
            this.authorizeRetainedContext(room.id, room.mode, input.context, capability)
          },
          history: (limit) => {
            return projectHistory(this.store.listMessages(room.id, limit), input.context.effective.settings)
          },
          async send() {
            throw new Error('呈现处理器不能直接发送消息')
          }
        }
      },
      id,
      phase,
      signal,
      (trace) => {
        const event: Trace = {
          id: crypto.randomUUID(),
          at: Date.now(),
          runId: id,
          roomId: room.id,
          kind: 'plugin',
          title: trace.point + ' · ' + trace.handler + ' · ' + trace.outcome,
          detail: trace.error ?? '',
          durationMs: trace.elapsedMs
        }
        this.store.saveTrace(event)
        this.events.emit({ type: 'trace', trace: event })
      },
      producer,
      deferred,
      inlineDeadlineAt
    )
    if (presentation && deferred && this.jobs) {
      presentation.captureAdmission = () => {
        return {
          configSnapshot: this.snapshotConfiguration(config),
          mode: room.mode,
          input: structuredClone(input)
        }
      }
      presentation.enqueue = (outbound) => {
        return this.jobs!.present(outbound)
      }
      presentation.validateRender = (outbound) => {
        this.validateRender(outbound)
      }
    }
    if (presentation && this.observations) {
      const observers = this.observations
      presentation.observation = (outbound) => {
        const payload = receiptNode.input.parse({
          phase,
          id: outbound.id,
          messageId: outbound.messageId,
          state: outbound.state,
          text: outbound.renderedText ?? outbound.text,
          originalText: outbound.text,
          artifactIds: outbound.artifactIds,
          platformMessageIds: outbound.platformMessageIds
        })
        const previous = this.store.getObservation('delivery.receipt@1:' + outbound.id)
        if (previous) {
          return { ...previous, ready: outbound.state !== 'sending', deadlineAt: Date.now() + 60000, payload }
        }
        const event = observers.create(config, room, input, receiptNode.id, outbound.id, payload, origin)
        if (event && outbound.state === 'sending') {
          event.ready = false
        }
        return event
      }
      presentation.receipt = () => {
        observers.wake()
      }
    }
    return presentation
  }

  private messageObservation(message: ObservedMessage, identity: TriggerIdentity) {
    if (!this.plugins?.available() || !this.observations) {
      return undefined
    }
    const invocation = this.jobInvocation(message.roomId, identity, message.text)
    return this.observations.create(
      invocation.config,
      invocation.room,
      { ...invocation.input, source: 'im' },
      recordedNode.id,
      message.id,
      recordedNode.input.parse({ message })
    )
  }

  authorizeRetainedContext(
    roomId: string,
    mode: Room['mode'],
    context: ExecutionContext,
    capability: string
  ) {
    if (capability.startsWith('mcp:')) {
      return this.authorizeExternalContext(
        roomId,
        mode,
        context,
        capability,
        capability.slice(4).split('/')[0]
      )
    }
    if (!capability.startsWith('plugin:') && !capability.startsWith('hook:plugin:')) {
      return this.authorizeContext(roomId, mode, context, capability)
    }
    this.checkContext(roomId, mode, context)
    const effective = this.effective(roomId, context.conversationId)
    assertCapability(context.authority, effective.settings, capability)
    let path = capability.slice('plugin:'.length)
    if (capability.startsWith('hook:plugin:')) {
      path = capability.slice('hook:plugin:'.length)
    }
    const [id, handler] = path.split('/')
    if (capability.startsWith('hook:') && effective.settings.extensions.disabled[id + '/' + handler]) {
      throw new Error('此处理器已停用')
    }
    const config = this.configuration()
    const instance = config.resources.config.plugins.find((instance) => {
      return instance.id === id
    })
    const selection = effective.settings.resources.plugins
    if (
      !config.bot.plugins.enabled ||
      !instance?.enabled ||
      (selection.mode === 'selected' && !selection.ids.includes(id))
    ) {
      throw new Error('此插件已停用或从当前范围移除')
    }
  }

  externalTaskLimit(serverId: string) {
    return (
      this.configuration().resources.config.mcp.find((server) => {
        return server.id === serverId
      })?.tasks.maxPending ?? 0
    )
  }

  snapshotConfiguration(config = this.configuration()) {
    return this.snapshots.save(config)
  }

  loadConfigurationSnapshot(id: string) {
    return this.snapshots.load(id)
  }

  jobInvocation(roomId: string, identity: TriggerIdentity, text: string): JobInvocation {
    return this.prepareJobInvocation(roomId, text, [identity])
  }

  scheduleInvocation(schedule: Schedule, occurrence: string): JobInvocation {
    if (!schedule.authority) {
      throw new Error('此计划缺少触发来源，请先重新授权')
    }
    if (
      this.store.recoverableRuns().some((run) => {
        return run.roomId === schedule.roomId && run.source === 'schedule' && !run.context?.jobId
      })
    ) {
      throw new ScheduleOverlap('此范围的旧版计划执行仍在恢复，暂不启动新计划工作')
    }
    const invocation = this.prepareJobInvocation(
      schedule.roomId,
      schedule.prompt,
      schedule.authority.identities,
      schedule.authority
    )
    if (!invocation.input.context.effective.settings.behavior.agentEnabled) {
      throw new Error('当前聊天范围已关闭 Agent')
    }
    invocation.runId = `schedule:${schedule.id}:${occurrence}`
    invocation.input = freezeSnapshot({
      ...invocation.input,
      source: 'schedule',
      actorId: 'scheduler',
      actorName: schedule.name,
      context: { ...invocation.input.context, schedule: { id: schedule.id, epoch: schedule.executionEpoch } }
    })
    invocation.authorize = (capability) => {
      this.authorizeContext(invocation.room.id, invocation.room.mode, invocation.input.context, capability)
    }
    return invocation
  }

  startSchedule(schedule: Schedule, occurrence: string, scheduledAt: number) {
    if (!this.jobs) {
      throw new Error('持久后台任务运行时尚未启用')
    }
    return this.jobs.startSchedule(schedule, occurrence, scheduledAt)
  }
  cancelSchedule(id: string) {
    if (!this.jobs) {
      return Promise.resolve()
    }
    return this.jobs.cancelSchedule(id)
  }

  private prepareJobInvocation(
    roomId: string,
    text: string,
    identities: readonly TriggerIdentity[],
    ceiling?: Authority
  ): JobInvocation {
    const room = this.requireRoom(roomId)
    this.assertRoomEnabled(room)
    const config = this.configuration()
    const effective = this.effective(roomId)
    const conversation = this.conversations.current(room)
    const authority = captureAuthority(
      effective,
      identities,
      ceiling?.capabilities,
      config.resources.capabilityIds(effective.settings)
    )
    const input: PreparedRunInput = freezeSnapshot({
      roomId,
      text,
      actorId: identities[0].actorId,
      actorName: identities[0].actorName,
      source: 'command',
      receivedAt: Date.now(),
      identities,
      inheritedAuthority: ceiling,
      context: {
        conversationId: conversation.id,
        rootConversationId: conversation.id,
        conversationEpoch: room.conversationEpoch,
        sessionKey: conversation.sessionKey,
        workspaceScope: room.id,
        capabilityRevisions: config.resources.capabilityRevisions(effective.settings),
        effective,
        authority
      }
    })
    return {
      config,
      room,
      input,
      runId: crypto.randomUUID(),
      authorize: (capability) => {
        this.authorizeContext(room.id, room.mode, input.context, capability)
      }
    }
  }

  publicError(error: unknown) {
    return this.configuration().catalog.redact(String(error)).slice(0, 2000)
  }

  enqueuePinned(
    id: string,
    config: Configuration,
    room: Room,
    input: PreparedRunInput,
    configSnapshot: string,
    deadlineAt: number
  ) {
    const existing = this.store.getRun(id)
    if (existing) {
      return existing
    }
    if (this.closing) {
      throw new Error('服务正在关闭')
    }
    this.checkContext(room.id, room.mode, input.context)
    const { context, ...request } = input
    const run: Run = {
      id,
      roomId: room.id,
      source: input.source,
      mode: room.mode,
      input: request,
      context,
      configSnapshot,
      deadlineAt,
      status: 'queued',
      providerGroup: input.context.effective.settings.preferences.providerGroup,
      createdAt: Date.now(),
      modelCalls: 0,
      toolCalls: 0,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
    }
    const controller = new AbortController()
    this.active.set(run.id, { roomId: room.id, controller, run, completion: Promise.withResolvers<Run>() })
    this.update(run)
    this.queueExecution({ config, room, input, run, controller })
    return run
  }

  async waitRun(id: string, signal?: AbortSignal) {
    const active = this.active.get(id)
    if (active) {
      if (signal) {
        return awaitWithContext(active.completion.promise, withAbortSignal(signal, BACKGROUND_CONTEXT))
      }
      return active.completion.promise
    }
    const run = this.store.getRun(id)
    if (!run) {
      throw new Error('任务执行记录不存在')
    }
    return run
  }

  cancelRun(id: string) {
    const active = this.active.get(id)
    if (!active) {
      return false
    }
    active.controller.abort('user')
    return true
  }

  effective(roomId: string, conversationId?: string) {
    const room = this.requireRoom(roomId)
    const conversation = this.conversations.require(conversationId ?? room.currentConversationId, roomId)
    if (conversation.parentId) {
      const parent = this.conversations.require(conversation.parentId, roomId)
      return resolveSettings(
        this.configuration().framework,
        room.address,
        room.settings,
        parent.settings,
        conversation.settings,
        this.configuration().resources.pluginConfigurations()
      )
    }
    return resolveSettings(
      this.configuration().framework,
      room.address,
      room.settings,
      conversation.settings,
      undefined,
      this.configuration().resources.pluginConfigurations()
    )
  }

  newConversation(roomId: string, title?: string) {
    const room = this.requireRoom(roomId)
    this.stop(roomId)
    return this.conversations.create(room, title)
  }

  switchConversation(roomId: string, conversationId: string) {
    const room = this.requireRoom(roomId)
    const conversation = this.conversations.require(conversationId, roomId)
    if (conversation.kind !== 'root') {
      throw new Error('后台任务对话不可切换为主对话')
    }
    if (room.currentConversationId === conversation.id) {
      return room
    }
    this.stop(roomId)
    return this.conversations.select(room, conversation)
  }

  private update(run: Run) {
    this.store.saveRun(run)
    this.events.emit({ type: 'run', run: { ...run, usage: { ...run.usage } } })
  }
  private trace(run: Run, event: Omit<Trace, 'id' | 'at' | 'runId' | 'roomId'>) {
    const trace: Trace = {
      ...event,
      id: crypto.randomUUID(),
      at: Date.now(),
      runId: run.id,
      roomId: run.roomId
    }
    this.store.saveTrace(trace)
    this.events.emit({ type: 'trace', trace })
  }
}
