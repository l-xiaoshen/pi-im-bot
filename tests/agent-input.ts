import type { PreparedRunInput } from '@pi-im-bot/contracts/run'
import type { Room } from '@pi-im-bot/contracts/message'
import { BotConfigSchema } from '@pi-im-bot/config/schema'
import { initialFramework, resolveSettings } from '@pi-im-bot/settings/resolve'
import { captureAuthority } from '@pi-im-bot/permissions/authorize'
import { localIdentity } from '@pi-im-bot/permissions/identity'
import { ResourceLibrary } from '@pi-im-bot/resources/library'

export function testResources() {
  return ResourceLibrary.empty()
}

export function testFramework() {
  return initialFramework(BotConfigSchema.parse({}), 'main')
}

export function agentInput(room: Room, text: string): PreparedRunInput {
  const effective = resolveSettings(testFramework(), room.address, room.settings)
  const identity = localIdentity(room.address.channel, room.address.accountId, 'test', 'test')
  return {
    roomId: room.id,
    text,
    actorId: 'test',
    actorName: 'test',
    source: 'im',
    receivedAt: Date.now(),
    identities: [identity],
    context: {
      conversationId: 'test-conversation',
      rootConversationId: 'test-conversation',
      conversationEpoch: room.conversationEpoch,
      sessionKey: `${room.id}:0`,
      capabilityRevisions: {},
      effective,
      authority: captureAuthority(effective, [identity])
    }
  }
}
