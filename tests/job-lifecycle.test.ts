import { expect, test } from 'bun:test'
import { inspectMcp } from '@pi-im-bot/resources/mcp/client'
import { mcpToolName } from '@pi-im-bot/resources/mcp/identity'
import { ResourceLibrary } from '@pi-im-bot/resources/library'
import { ResourcesConfigSchema } from '@pi-im-bot/resources/schema'
import { localIdentity, type TriggerIdentity } from '@pi-im-bot/permissions/identity'
import { mcpFixture } from './mcp-fixture'
import { jobHarness, latestUser, pendingResponse, untilJob } from './job-harness'
import { responsesReply } from './responses-fixture'
import { createFakeShipyard } from './shipyard-fixture'
import { ShipyardConfigSchema } from '@pi-im-bot/execution/config'
import { ArtifactStore } from '@pi-im-bot/artifacts/store'
import { join } from 'node:path'
import { RunSchema } from '@pi-im-bot/contracts/run'
import { executeJobCommand } from '@pi-im-bot/jobs/commands'

test('another member can revise shared work without inheriting the previous member privileges or delivering the old revision', async () => {
  const mcp = mcpFixture()
  const manifest = await inspectMcp(mcp.config, new AbortController().signal)
  let revisedCalls = 0
  const env = await jobHarness(
    (raw) => {
      if (!latestUser(raw).includes('BOB_REVISION')) {
        return pendingResponse()
      }
      revisedCalls += 1
      if (revisedCalls === 1) {
        return responsesReply({
          kind: 'tool',
          name: mcpToolName('reports', 'long-result'),
          arguments: { query: 'not allowed for Bob' }
        })
      }
      return responsesReply({ kind: 'text', text: 'NEW_REVISION_RESULT' })
    },
    new ResourceLibrary(ResourcesConfigSchema.parse({ mcp: [mcp.config] }), [manifest])
  )
  try {
    env.config.framework.defaults.permissions.rules = [
      {
        effect: 'deny',
        capabilities: ['mcp:reports/*'],
        subjects: [{ kind: 'platform-user', channel: 'mock', accountId: 'mock-bot', actorId: 'bob' }]
      }
    ]
    const alice: TriggerIdentity = {
      origin: 'platform',
      channel: 'mock',
      accountId: 'mock-bot',
      actorId: 'alice',
      actorName: 'Alice',
      messageIds: []
    }
    const bob = { ...alice, actorId: 'bob', actorName: 'Bob' }
    const first = await env.jobs.start(
      env.coordinator.jobInvocation(env.room.id, alice, 'initial'),
      'Shared research',
      { kind: 'agent', prompt: 'OLD_REVISION' },
      'first'
    )
    await untilJob(() => {
      return env.requests.length > 0
    }, 'Original worker did not start')
    const next = await env.jobs.update(
      env.coordinator.jobInvocation(env.room.id, bob, 'revision'),
      first.id,
      1,
      'BOB_REVISION',
      'revision'
    )
    expect(next.revision).toBe(2)
    await untilJob(async () => {
      return (await env.jobs.repository.get(first.id)).revisions['2'].delivery === 'sent'
    }, 'New revision did not complete')
    const job = await env.jobs.repository.get(first.id)
    expect(job.revisions['2'].context.authority.identities[0].actorId).toBe('bob')
    expect(job.revisions['2'].context.authority.capabilities).not.toContain('mcp:reports/long-result')
    expect(job.revisions['1'].delivery).toBe('suppressed')
    expect(mcp.state.calls).toBe(0)
    expect(
      env.store.listMessages(env.room.id).filter((message) => {
        return message.role === 'assistant'
      })
    ).toHaveLength(1)
    expect(env.store.listMessages(env.room.id).at(-1)?.text).toContain('NEW_REVISION_RESULT')
    await expect(
      env.jobs.update(env.coordinator.jobInvocation(env.room.id, bob, 'stale'), first.id, 1, 'stale', 'stale')
    ).rejects.toThrow('版本已变化')
  } finally {
    await env.close()
    await mcp.server.stop(true)
  }
})

test('a background agent resumes after host shutdown without rerunning a completed MCP operation', async () => {
  const mcp = mcpFixture()
  const manifest = await inspectMcp(mcp.config, new AbortController().signal)
  const env = await jobHarness(
    (_raw, call) => {
      if (call === 1) {
        return responsesReply({
          kind: 'tool',
          name: mcpToolName('reports', 'long-result'),
          arguments: { query: 'once' }
        })
      }
      if (call === 2) {
        return pendingResponse()
      }
      return responsesReply({ kind: 'text', text: 'RECOVERED_JOB_RESULT' })
    },
    new ResourceLibrary(ResourcesConfigSchema.parse({ mcp: [mcp.config] }), [manifest])
  )
  try {
    const invocation = env.coordinator.jobInvocation(env.room.id, localIdentity('mock', 'mock-bot'), 'work')
    const job = await env.jobs.start(
      invocation,
      'Recover work',
      { kind: 'agent', prompt: 'finish this job' },
      'start'
    )
    await untilJob(() => {
      return env.requests.length === 2
    }, 'Worker did not reach the pending request')
    expect(mcp.state.calls).toBe(1)
    await env.restart()
    await untilJob(async () => {
      return (await env.jobs.repository.get(job.id)).revisions['1'].delivery === 'sent'
    }, 'Worker did not recover')
    expect(mcp.state.calls).toBe(1)
    expect(
      env.store.listMessages(env.room.id).filter((message) => {
        return message.text.includes('RECOVERED_JOB_RESULT')
      })
    ).toHaveLength(1)
  } finally {
    await env.close()
    await mcp.server.stop(true)
  }
})

test('an external operation interrupted before its receipt becomes unknown after restart and is never resubmitted', async () => {
  const mcp = mcpFixture()
  const manifest = await inspectMcp(mcp.config, new AbortController().signal)
  mcp.state.wait = true
  const env = await jobHarness(
    () => {
      throw new Error('An operation job must not call an LLM')
    },
    new ResourceLibrary(ResourcesConfigSchema.parse({ mcp: [mcp.config] }), [manifest])
  )
  try {
    const job = await env.jobs.start(
      env.coordinator.jobInvocation(env.room.id, localIdentity('mock', 'mock-bot'), 'operation'),
      'External work',
      { kind: 'tool', capability: 'mcp:reports/long-result', arguments: { query: 'once' } },
      'start'
    )
    await untilJob(() => {
      return mcp.state.calls === 1
    }, 'Operation did not dispatch')
    await env.restart()
    await untilJob(async () => {
      return (await env.jobs.repository.get(job.id)).revisions['1'].delivery === 'sent'
    }, 'Unknown outcome was not reported')
    const result = await env.jobs.repository.get(job.id)
    expect(result.revisions['1'].state).toBe('outcome_unknown')
    expect(mcp.state.calls).toBe(1)
    expect(env.requests).toHaveLength(0)
  } finally {
    await env.close()
    await mcp.server.stop(true)
  }
})

test('a background agent publishes a guest file and delivers the persisted artifact without reading a same-named host file', async () => {
  const bay = createFakeShipyard()
  let path = ''
  const env = await jobHarness((_raw, call) => {
    if (call === 1) {
      return responsesReply({ kind: 'tool', name: 'write', arguments: { path, content: 'GUEST_RESULT' } })
    }
    if (call === 2) {
      return responsesReply({
        kind: 'tool',
        name: 'artifact_publish',
        arguments: { path, name: 'report.txt' }
      })
    }
    return responsesReply({ kind: 'text', text: 'FILE_READY' })
  })
  try {
    path = join(env.config.dataDir, 'host-file.txt')
    await Bun.write(path, 'HOST_SECRET')
    env.config.bot.agent.execution = ShipyardConfigSchema.parse({
      backend: 'shipyard',
      endpoint: bay.endpoint,
      apiKey: 'test-bay-key'
    })
    const job = await env.jobs.start(
      env.coordinator.jobInvocation(env.room.id, localIdentity('mock', 'mock-bot'), 'publish'),
      'Publish file',
      { kind: 'agent', prompt: 'create and publish a file' },
      'publish'
    )
    await untilJob(async () => {
      return (await env.jobs.repository.get(job.id)).revisions['1'].delivery === 'sent'
    }, 'Published file was not delivered')
    const result = (await env.jobs.repository.get(job.id)).revisions['1'].result!
    expect(result.artifactIds).toHaveLength(1)
    const artifact = await new ArtifactStore(env.config.dataDir, env.room.id).content(result.artifactIds[0])
    expect(await artifact.file.text()).toBe('GUEST_RESULT')
    expect(await Bun.file(path).text()).toBe('HOST_SECRET')
    expect(env.requests.join('')).not.toContain('HOST_SECRET')
    expect(env.store.listMessages(env.room.id).at(-1)?.attachments[0].url).toContain(result.artifactIds[0])
  } finally {
    await env.close()
    await bay.close()
  }
})

test('shared task commands bypass the model, bound outstanding work, and cancellation preserves completed results awaiting root acknowledgment', async () => {
  const env = await jobHarness(() => {
    return responsesReply({ kind: 'text', text: 'READY_BEFORE_ACK' })
  })
  try {
    env.config.framework.defaults.behavior.maxOutstandingJobs = 1
    const invoke = env.coordinator.jobInvocation(env.room.id, localIdentity('mock', 'mock-bot'), 'first')
    env.store.saveRun(
      RunSchema.parse({
        id: invoke.runId,
        roomId: env.room.id,
        source: 'im',
        mode: 'live',
        status: 'running',
        providerGroup: 'main',
        createdAt: Date.now(),
        usage: {}
      })
    )
    const job = await env.jobs.start(
      invoke,
      'Awaiting acknowledgment',
      { kind: 'agent', prompt: 'complete' },
      'first'
    )
    await untilJob(async () => {
      return (await env.jobs.repository.get(job.id)).revisions['1'].state === 'succeeded'
    }, 'Job did not finish')
    const another = env.coordinator.jobInvocation(
      env.room.id,
      localIdentity('mock', 'mock-bot', 'bob', 'Bob'),
      'second'
    )
    await expect(
      env.jobs.start(another, 'Too many', { kind: 'agent', prompt: 'must not start' }, 'second')
    ).rejects.toThrow('未收尾')
    const calls = env.requests.length
    expect(await executeJobCommand(env.jobs, another, '/jobs')).toContain(job.id.slice(0, 8))
    expect(await executeJobCommand(env.jobs, another, '/job ' + job.id.slice(0, 8))).toContain(
      'READY_BEFORE_ACK'
    )
    await executeJobCommand(env.jobs, another, '/job cancel ' + job.id.slice(0, 8))
    await untilJob(async () => {
      return (await env.jobs.repository.get(job.id)).revisions['1'].delivery === 'suppressed'
    }, 'Delivery did not stop')
    const saved = (await env.jobs.repository.get(job.id)).revisions['1']
    expect(saved.state).toBe('succeeded')
    expect(saved.result?.summary).toBe('READY_BEFORE_ACK')
    expect(env.store.listMessages(env.room.id)).toHaveLength(0)
    expect(env.requests).toHaveLength(calls)
    env.store.saveRun({ ...env.store.getRun(invoke.runId)!, status: 'completed' })
  } finally {
    await env.close()
  }
})
