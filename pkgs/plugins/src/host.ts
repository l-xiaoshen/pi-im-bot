import { namedService, serviceRevision } from '@pi-im-bot/integrations/resources'
import { registerPluginState } from './state/rpc'
import { registerComfy } from './comfy-rpc'
import type { PluginManagedServices } from './managed'
import type { PluginAction } from './rpc/protocol'
import { z } from 'zod'
import { ArtifactStore } from '@pi-im-bot/artifacts/store'
import { PluginHostServices } from './rpc/services'
import type { PluginInvocation } from './invocation'
import type { PluginBinding } from './registry'
import { pluginArtifactStoreOwner } from './result'
import { registerPluginConnectors } from './connectors'
import { registerPluginOperations, type PluginOperationCallSchema } from './operations-rpc'
import { PluginPathSchema } from './manifest'
import type { FileHandle } from 'node:fs/promises'
import { registerPluginPoints } from './points'
import { collectRuntimeStatus } from '@pi-im-bot/runtime/status/collect'
import { registerPluginMedia } from './media-rpc'
import { registerPluginServices } from './service-rpc'
import { gsviExecutionRevision } from '@pi-im-bot/integrations/gsvi/identity'
import { reserveMediaSources } from '@pi-im-bot/media/dependencies'
import type { ArtifactAccess } from '@pi-im-bot/artifacts/access'
import { SendMessageInputSchema, logicalMessages } from '@pi-im-bot/contracts/logical-message'
import { sendLogicalSequence } from '@pi-im-bot/runtime/logical-send'

export function pluginHostServices(
  invocation: PluginInvocation,
  binding: PluginBinding,
  callId: string,
  authorizeGrant: (grant: string) => void,
  operations?: {
    grants: readonly string[]
    invoke(
      grant: string,
      input: z.infer<typeof PluginOperationCallSchema>,
      signal: AbortSignal
    ): Promise<unknown>
  },
  openFile?: (path: string) => Promise<FileHandle>,
  point?: (
    grant: string,
    value: Record<string, z.infer<ReturnType<typeof z.json>>>,
    sequence: number,
    signal: AbortSignal
  ) => Promise<unknown>,
  managed?: PluginManagedServices,
  phase: PluginAction['phase'] = 'execute'
) {
  const host = new PluginHostServices()
  const sources = invocation.services.mediaSources ?? new Set<string>()
  const usedCapabilities = new Set<string>()
  const usedGrants = new Set<string>()
  const access = () => {
    const services: NonNullable<ArtifactAccess['plugin']>['services'] = {}
    for (const capability of usedCapabilities) {
      invocation.services.authorize(capability)
    }
    for (const grant of usedGrants) {
      authorizeGrant(grant)
      if (grant.startsWith('service:')) {
        const alias = grant.slice(8)
        const id = binding.instance.services[alias]
        const service = namedService(invocation.config, id)
        if (!service) {
          throw new Error('具名服务已不可用')
        }
        services[alias] = { id, revision: serviceRevision(service) }
      }
    }
    for (const id of sources) {
      invocation.services.authorize('media_read')
      const media = invocation.services.media
      if (!media) {
        throw new Error('入站媒体服务未配置')
      }
      media.require(id)
    }
    const capabilities = new Set(usedCapabilities)
    if (sources.size) {
      capabilities.add('media_read')
    }
    return {
      mediaIds: [...sources],
      capabilities: [...capabilities],
      plugin: { instanceId: binding.instance.id, grants: [...usedGrants], services }
    }
  }
  host.validateResult = () => {
    access()
  }
  host.register('system.status', 'system.status', z.object({}).strict(), async (_input, context) => {
    invocation.services.authorize('runtime_status')
    const snapshot = await collectRuntimeStatus(invocation.config)
    context.signal.throwIfAborted()
    authorizeGrant('system.status')
    invocation.services.authorize('runtime_status')
    return snapshot
  })
  registerPluginState(host, invocation, binding, managed, authorizeGrant)
  const artifacts = new ArtifactStore(
    invocation.config.dataDir,
    invocation.room.id,
    pluginArtifactStoreOwner(invocation.input.context),
    'plugin:' + binding.instance.id,
    access,
    (dependency) => {
      if (dependency.mediaIds.length) {
        checkGrant('media.read')
        reserveMediaSources(sources, dependency.mediaIds)
        access()
      }
    }
  )
  const checkGrant = (grant: string) => {
    authorizeGrant(grant)
    usedGrants.add(grant)
  }
  registerPluginMedia(
    host,
    invocation,
    () => {
      invocation.services.authorize('media_read')
      checkGrant('media.read')
      usedCapabilities.add('media_read')
    },
    sources
  )
  registerComfy(host, invocation, binding, artifacts, checkGrant, usedCapabilities, managed, phase)
  registerPluginServices(host, invocation, binding, artifacts, checkGrant, usedCapabilities, phase)
  registerPluginConnectors(host, invocation, binding, artifacts, callId)
  if (operations) {
    registerPluginOperations(host, operations.grants, operations.invoke)
    if (point) {
      registerPluginPoints(host, operations.grants, point)
    }
  }
  let publishedBytes = 0
  let publishedCount = 0
  host.register(
    'history.read',
    'history.read',
    z.object({ limit: z.number().int().min(1).max(100).default(20) }).strict(),
    async (input) => {
      invocation.services.authorize('chat_history')
      return invocation.services.history(input.limit)
    }
  )
  host.register(
    'artifact.read',
    'artifact.read',
    z
      .object({
        id: z.uuid(),
        offset: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).max(196608).default(65536)
      })
      .strict(),
    async (input, context) => {
      checkGrant('artifact.read')
      invocation.services.authorize('artifact_read')
      usedCapabilities.add('artifact_read')
      const artifact = await artifacts.content(input.id)
      const bytes = new Uint8Array(
        await artifact.file.slice(input.offset, input.offset + input.limit).arrayBuffer()
      )
      context.signal.throwIfAborted()
      access()
      return {
        id: input.id,
        mimeType: artifact.metadata.mimeType,
        bytes: artifact.metadata.bytes,
        offset: input.offset,
        base64: Buffer.from(bytes).toString('base64'),
        hasMore: input.offset + bytes.length < artifact.metadata.bytes
      }
    }
  )
  host.register(
    'artifact.write',
    'artifact.write',
    z
      .object({
        name: z.string().min(1).max(200),
        mimeType: z.string().min(1).max(100),
        encoding: z.enum(['text', 'base64']),
        data: z.string().max(300000)
      })
      .strict(),
    async (input, context) => {
      checkGrant('artifact.write')
      let bytes = Buffer.from(input.data)
      if (input.encoding === 'base64') {
        bytes = Buffer.from(input.data, 'base64')
      }
      publishedBytes += bytes.length
      publishedCount += 1
      if (publishedBytes > 8 * 1024 * 1024 || publishedCount > 12) {
        throw new Error('插件本次产物额度已用完')
      }
      context.signal.throwIfAborted()
      const artifact = await artifacts.save(
        input.name,
        input.mimeType,
        'plugin:' + binding.instance.id,
        bytes
      )
      return { id: artifact.id, name: artifact.name, mimeType: artifact.mimeType, bytes: artifact.bytes }
    }
  )
  let sends = 0
  if (openFile) {
    host.register(
      'artifact.publish',
      'artifact.write',
      z
        .object({
          path: PluginPathSchema,
          name: z.string().min(1).max(240).optional(),
          mimeType: z.string().min(1).max(100).default('application/octet-stream')
        })
        .strict(),
      async (input, context) => {
        checkGrant('artifact.write')
        context.signal.throwIfAborted()
        const file = await openFile(input.path)
        try {
          const artifact = await artifacts.saveFile(
            input.name ?? input.path.split('/').at(-1)!,
            input.mimeType,
            'plugin:' + binding.instance.id,
            file,
            context.signal
          )
          return {
            id: artifact.id,
            name: artifact.name,
            mimeType: artifact.mimeType,
            bytes: artifact.bytes,
            sha256: artifact.sha256
          }
        } finally {
          await file.close()
        }
      }
    )
  }
  if (invocation.services.recall) {
    const recall = invocation.services.recall
    host.register(
      'delivery.recall',
      'delivery.recall',
      z.object({ messageId: z.uuid(), delayMs: z.number().int().min(0).max(86400000).default(0) }).strict(),
      async (input, context) => {
        context.signal.throwIfAborted()
        invocation.services.authorize('message_recall')
        return recall(input.messageId, input.delayMs)
      }
    )
  }
  host.register('delivery.send', 'delivery.send', SendMessageInputSchema, async (input, context) => {
    invocation.services.authorize('chat_send')
    context.signal.throwIfAborted()
    const parts = logicalMessages(input)
    const first = sends
    sends += parts.length
    if (sends > 8) {
      throw new Error('插件本次直接消息额度已用完')
    }
    const check = () => {
      context.signal.throwIfAborted()
      authorizeGrant('delivery.send')
      invocation.services.authorize('chat_send')
    }
    const send = (part: (typeof parts)[number], index: number) =>
      invocation.services.send(
        part.text,
        callId + ':plugin:' + (first + index + 1),
        part.artifactIds,
        check,
        { signal: context.signal, deadlineAt: context.invocation.deadlineAt }
      )
    if ('messages' in input) {
      return sendLogicalSequence(parts, send, check)
    }
    const message = await send(parts[0], 0)
    return { id: message.id, platformMessageIds: message.platformMessageIds }
  })
  return host
}
