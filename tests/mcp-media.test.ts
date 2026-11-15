import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { z } from 'zod'
import { mcpFixture } from './mcp-fixture'
import { inspectMcp } from '@pi-im-bot/resources/mcp/client'
import { ResourceLibrary } from '@pi-im-bot/resources/library'
import { ResourcesConfigSchema } from '@pi-im-bot/resources/schema'
import { createMcpTools } from '@pi-im-bot/resources/mcp/tools'
import { ArtifactStore } from '@pi-im-bot/artifacts/store'
import { testFramework } from './agent-input'

test('MCP binary results remain scoped downloadable artifacts while private metadata and raw audio stay out of the model context', async () => {
  const root = await mkdtemp('/tmp/pi-mcp-media-')
  const audio = Buffer.from('AUDIO_BYTES').toString('base64')
  const mcp = mcpFixture({
    content: [
      { type: 'text', text: 'fixture-secret', _meta: { private: 'PRIVATE_METADATA' } },
      { type: 'audio', data: audio, mimeType: 'audio/wav' },
      {
        type: 'resource',
        resource: {
          uri: 'file:///not-on-host/video.mp4',
          mimeType: 'video/mp4',
          blob: Buffer.from('VIDEO_BYTES').toString('base64')
        }
      },
      { type: 'resource_link', uri: 'http://127.0.0.1:1/must-not-fetch', name: 'external resource' }
    ],
    _meta: { private: 'PRIVATE_METADATA' }
  })
  const controller = new AbortController()
  let close = async () => {}
  try {
    const manifest = await inspectMcp(mcp.config, controller.signal)
    const library = new ResourceLibrary(ResourcesConfigSchema.parse({ mcp: [mcp.config] }), [manifest])
    const artifacts = new ArtifactStore(root, 'room', 'job:1:1')
    const toolkit = createMcpTools(
      library,
      testFramework().defaults,
      ['mcp:reports/long-result'],
      artifacts,
      controller.signal
    )
    close = toolkit.close
    const result = await toolkit.tools[0].execute('call', { query: 'media' }, controller.signal, undefined)
    const { artifactIds } = z.object({ artifactIds: z.array(z.string()) }).parse(result.details)
    expect(artifactIds).toHaveLength(2)
    expect(JSON.stringify(result.content)).not.toContain(audio)
    expect(JSON.stringify(result)).not.toContain('PRIVATE_METADATA')
    expect(JSON.stringify(result)).not.toContain('fixture-secret')
    expect(
      result.content.some((part) => {
        return part.type === 'text' && part.text.includes(artifactIds[0])
      })
    ).toBe(true)
    const savedAudio = await artifacts.content(artifactIds[0])
    expect(savedAudio.metadata.mimeType).toBe('audio/wav')
    expect(await savedAudio.file.text()).toBe('AUDIO_BYTES')
    expect(await artifacts.owned('job:1:1')).toHaveLength(2)
    await expect(new ArtifactStore(root, 'different-room').content(artifactIds[0])).rejects.toThrow(
      '当前聊天范围'
    )
    expect(mcp.state.calls).toBe(1)
  } finally {
    await close()
    await mcp.server.stop(true)
    await rm(root, { recursive: true, force: true })
  }
})

test('an oversized JSON MCP result is stopped before parsing or archiving and is not replayed', async () => {
  const root = await mkdtemp('/tmp/pi-mcp-budget-')
  const mcp = mcpFixture({ content: [{ type: 'text', text: 'x'.repeat(9 * 1024 * 1024) }] })
  const controller = new AbortController()
  let close = async () => {}
  try {
    const manifest = await inspectMcp(mcp.config, controller.signal)
    const library = new ResourceLibrary(ResourcesConfigSchema.parse({ mcp: [mcp.config] }), [manifest])
    const toolkit = createMcpTools(
      library,
      testFramework().defaults,
      ['mcp:reports/long-result'],
      new ArtifactStore(root, 'room'),
      controller.signal
    )
    close = toolkit.close
    await expect(
      toolkit.tools[0].execute('budget', { query: 'large' }, controller.signal, undefined)
    ).rejects.toThrow('响应预算')
    expect(mcp.state.calls).toBe(1)
  } finally {
    await close()
    await mcp.server.stop(true)
    await rm(root, { recursive: true, force: true })
  }
})
