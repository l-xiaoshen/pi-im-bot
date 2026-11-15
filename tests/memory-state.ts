import type { StateStore } from '@pi-im-bot/storage/state'
import type { Room, ChatMessage } from '@pi-im-bot/contracts/message'
import type { Run, Trace } from '@pi-im-bot/contracts/run'
import type { Schedule } from '@pi-im-bot/scheduler/definition'
import type { Conversation } from '@pi-im-bot/conversations/schema'
import type { Outbound } from '@pi-im-bot/contracts/delivery'
import { mergeDeliveryEchoes } from '@pi-im-bot/storage/delivery-merge'
import type { MediaRecord } from '@pi-im-bot/media/schema'
import { recallKey, recalledMessage } from '@pi-im-bot/messages/recall'
import type { Observation } from '@pi-im-bot/plugins/observations/schema'

// Protocol/coordinator tests use memory only; no database behavior is tested.
export class MemoryState implements Pick<StateStore, keyof StateStore> {
  private rooms = new Map<string, Room>()
  private messages = new Map<string, ChatMessage>()
  private runs = new Map<string, Run>()
  private traces = new Map<string, Trace>()
  private schedules = new Map<string, Schedule>()
  private conversations = new Map<string, Conversation>()
  private outbound = new Map<string, Outbound>()
  private media = new Map<string, MediaRecord>()
  private recalls = new Set<string>()
  private observations = new Map<string, Observation>()

  listRooms() {
    return [...this.rooms.values()]
  }
  getRoom(id: string) {
    return this.rooms.get(id)
  }
  saveRoom(room: Room) {
    this.rooms.set(room.id, room)
  }
  listConversations(roomId?: string) {
    return [...this.conversations.values()].filter((item) => {
      return !roomId || item.roomId === roomId
    })
  }
  getConversation(id: string) {
    return this.conversations.get(id)
  }
  saveConversation(conversation: Conversation) {
    this.conversations.set(conversation.id, structuredClone(conversation))
  }
  saveConversationSelection(room: Room, conversation: Conversation) {
    this.saveConversation(conversation)
    this.saveRoom(room)
  }
  listMessages(roomId: string, limit = 200) {
    return [...this.messages.values()]
      .filter((item) => {
        return item.roomId === roomId
      })
      .slice(-limit)
  }
  saveMessage(message: ChatMessage, observation?: Observation) {
    this.messages.set(message.id, message)
    if (observation) {
      this.saveObservation(observation)
    }
  }
  getMessage(id: string) {
    return this.messages.get(id)
  }
  pendingInbound(limit: number, workOnly = false) {
    return [...this.messages.values()]
      .filter((message) => {
        const admission = message.inbound
        return (
          (admission?.state === 'pending' || admission?.state === 'dispatching') &&
          (!workOnly || !admission.control)
        )
      })
      .slice(0, limit)
  }
  cancelPendingInbound(roomId: string) {
    const cancelled: ChatMessage[] = []
    for (const message of this.messages.values()) {
      if (message.roomId === roomId && message.inbound?.state === 'pending') {
        const updated: ChatMessage = {
          ...message,
          inbound: { state: 'cancelled', error: '此输入已由范围停止操作取消，未执行' }
        }
        this.saveMessage(updated)
        cancelled.push(updated)
      }
    }
    return cancelled
  }
  saveRunAdmission(run: Run, messages: ChatMessage[]) {
    this.saveRun(run)
    for (const message of messages) {
      this.saveMessage(message)
    }
  }
  getMedia(id: string) {
    return this.media.get(id)
  }
  saveMedia(media: MediaRecord) {
    this.media.set(media.id, structuredClone(media))
  }
  wasRecalled(roomId: string, platformId: string) {
    return this.recalls.has(recallKey(roomId, platformId))
  }
  recordRecall(roomId: string, platformId: string) {
    this.recalls.add(recallKey(roomId, platformId))
    const message = this.findPlatformMessage(roomId, platformId)
    if (message) {
      const updated = recalledMessage(message, [platformId])
      this.saveMessage(updated)
      return updated
    }
    return undefined
  }
  getOutbound(id: string) {
    return this.outbound.get(id)
  }
  listOutbound(roomId?: string) {
    return [...this.outbound.values()].filter((item) => {
      return !roomId || item.roomId === roomId
    })
  }
  pendingPresentations(roomId: string) {
    return this.listOutbound(roomId).filter((outbound) => {
      return outbound.render && ['rendering', 'prepared', 'sending'].includes(outbound.state)
    })
  }
  saveObservation(observation: Observation) {
    this.observations.set(observation.id, structuredClone(observation))
  }
  hasObservation(id: string) {
    return this.observations.has(id)
  }
  getObservation(id: string) {
    return this.observations.get(id)
  }
  observationCount() {
    return this.observations.size
  }
  listObservations(includePreparing = false) {
    let limit = 64
    if (includePreparing) {
      limit = 1000
    }
    return [...this.observations.values()]
      .filter((event) => {
        return includePreparing || event.ready
      })
      .slice(0, limit)
  }
  deleteObservation(id: string) {
    this.observations.delete(id)
  }
  saveOutbound(outbound: Outbound, observation?: Observation) {
    this.outbound.set(outbound.id, structuredClone(outbound))
    if (observation) {
      this.saveObservation(observation)
    }
  }
  saveDelivery(message: ChatMessage, outbound: Outbound, observation?: Observation) {
    const echoes = this.listMessages(message.roomId).filter((echo) => {
      return echo.platformMessageIds.some((id) => {
        return message.platformMessageIds.includes(id)
      })
    })
    const merged = mergeDeliveryEchoes(
      recalledMessage(
        message,
        message.platformMessageIds.filter((id) => {
          return this.wasRecalled(message.roomId, id)
        })
      ),
      echoes
    )
    for (const id of merged.removedIds) {
      this.messages.delete(id)
    }
    this.saveMessage(merged.message, observation)
    this.saveOutbound(outbound)
    return merged
  }
  recoverableRuns() {
    return this.listRuns().filter((run) => {
      return run.engine === 'durable' && ['batching', 'queued', 'running', 'interrupted'].includes(run.status)
    })
  }
  findPlatformMessage(roomId: string, id: string) {
    return [...this.messages.values()].find((message) => {
      return message.roomId === roomId && message.platformMessageIds.includes(id)
    })
  }
  listRuns(roomId?: string) {
    return [...this.runs.values()].filter((run) => {
      return !roomId || run.roomId === roomId
    })
  }
  getRun(id: string) {
    return this.runs.get(id)
  }
  saveRun(run: Run) {
    this.runs.set(run.id, { ...run })
  }
  listTraces(roomId?: string) {
    return [...this.traces.values()].filter((trace) => {
      return !roomId || trace.roomId === roomId
    })
  }
  saveTrace(trace: Trace) {
    this.traces.set(trace.id, trace)
  }
  listSchedules() {
    return [...this.schedules.values()]
  }
  saveSchedule(schedule: Schedule) {
    this.schedules.set(schedule.id, schedule)
  }
  deleteSchedule(id: string) {
    this.schedules.delete(id)
  }
  close() {}
}
