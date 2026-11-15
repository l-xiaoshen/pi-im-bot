import { expect, test } from 'bun:test'
import { mcpTaskFixture } from './mcp-task-fixture'
import { inspectMcp } from '@pi-im-bot/resources/mcp/client'
import { ResourceLibrary } from '@pi-im-bot/resources/library'
import { ResourcesConfigSchema } from '@pi-im-bot/resources/schema'
import { mcpToolName } from '@pi-im-bot/resources/mcp/identity'
import { jobHarness, latestUser, untilJob } from './job-harness'
import { responsesReply } from './responses-fixture'
import { localIdentity } from '@pi-im-bot/permissions/identity'

async function resources(fixture: ReturnType<typeof mcpTaskFixture>) {
  const manifest = await inspectMcp(fixture.config, new AbortController().signal)
  return new ResourceLibrary(ResourcesConfigSchema.parse({ mcp: [fixture.config] }), [manifest])
}

test('task-required MCP tools return a Job, leave the shared root responsive, and resume the same remote session after restart', async () => {
  const mcp = mcpTaskFixture()
  let launch = 0
  const env = await jobHarness(
    (raw) => {
      if (latestUser(raw).includes('LAUNCH_EXTERNAL') && ++launch === 1) {
        return responsesReply({
          kind: 'tool',
          name: mcpToolName('rendering', 'render'),
          arguments: { prompt: 'draw' }
        })
      }
      return responsesReply({ kind: 'text', text: 'Root is responsive' })
    },
    await resources(mcp)
  )
  try {
    const run = await env.coordinator.receive(env.room.id, 'LAUNCH_EXTERNAL', 'alice', 'Alice')
    expect((await env.coordinator.waitRun(run!.id)).status).toBe('completed')
    await untilJob(() => {
      return mcp.state.submissions === 1
    }, 'MCP task was not submitted')
    const pending = (await env.jobs.repository.list(env.room.id))[0]
    await untilJob(async () => {
      return (await env.jobs.repository.get(pending.id)).revisions['1'].external?.status === 'working'
    }, 'Task handle was not persisted')
    const second = await env.coordinator.receive(env.room.id, 'FAST_QUESTION', 'bob', 'Bob')
    expect((await env.coordinator.waitRun(second!.id)).status).toBe('completed')
    expect(pending.state).not.toBe('succeeded')
    const initializes = mcp.state.initializes
    const deletes = mcp.state.deletes
    await env.restart()
    mcp.complete()
    await untilJob(async () => {
      return (await env.jobs.repository.get(pending.id)).revisions['1'].delivery === 'sent'
    }, 'Remote task did not recover')
    expect(mcp.state.submissions).toBe(1)
    expect(mcp.state.initializes).toBe(initializes)
    expect(mcp.state.deletes).toBe(deletes + 1)
    expect(mcp.state.duplicateIds).toBe(0)
    expect(
      env.store.listMessages(env.room.id).filter((message) => {
        return message.text.includes('EXTERNAL_RESULT')
      })
    ).toHaveLength(1)
    expect(JSON.stringify(await env.jobs.repository.get(pending.id))).not.toContain('PRIVATE_MCP_SESSION')
    expect(env.requests.join('')).not.toContain('PRIVATE_MCP_SESSION')
  } finally {
    await env.close()
    await mcp.server.stop(true)
  }
})

test('an unacknowledged external submission stays unknown after restart and is not resubmitted', async () => {
  const mcp = mcpTaskFixture()
  mcp.state.holdSubmit = true
  const env = await jobHarness(
    () => {
      throw new Error('No model request expected')
    },
    await resources(mcp)
  )
  try {
    const job = await env.jobs.start(
      env.coordinator.jobInvocation(env.room.id, localIdentity('mock', 'mock-bot'), 'submit'),
      'Unknown submission',
      { kind: 'tool', capability: 'mcp:rendering/render', arguments: { prompt: 'once' } },
      'submit'
    )
    await untilJob(() => {
      return mcp.state.submissions === 1
    }, 'Submission did not dispatch')
    await env.restart()
    await untilJob(async () => {
      return (await env.jobs.repository.get(job.id)).revisions['1'].delivery === 'sent'
    }, 'Unknown outcome not reported')
    expect((await env.jobs.repository.get(job.id)).revisions['1'].state).toBe('outcome_unknown')
    expect(mcp.state.submissions).toBe(1)
    expect(mcp.state.deletes).toBe(1)
    expect(env.requests).toHaveLength(0)
  } finally {
    await env.close()
    await mcp.server.stop(true)
  }
})

test('remote capacity queues only its own operations, cancellation is confirmed remotely, and lost HTTP sessions can be reattached without a new submission', async () => {
  const mcp = mcpTaskFixture()
  const env = await jobHarness(
    () => {
      throw new Error('No model request expected')
    },
    await resources(mcp)
  )
  try {
    function invoke() {
      return env.coordinator.jobInvocation(env.room.id, localIdentity('mock', 'mock-bot'), 'work')
    }
    const spec = {
      kind: 'tool' as const,
      capability: 'mcp:rendering/render',
      arguments: { prompt: 'queued' }
    }
    const first = await env.jobs.start(invoke(), 'First', spec, 'first')
    await untilJob(async () => {
      return (await env.jobs.repository.get(first.id)).revisions['1'].external?.status === 'working'
    }, 'First not pending')
    const second = await env.jobs.start(invoke(), 'Second', spec, 'second')
    await untilJob(async () => {
      return (await env.jobs.repository.get(second.id)).revisions['1'].external?.status === 'waiting_capacity'
    }, 'Capacity did not isolate the second task')
    expect(mcp.state.submissions).toBe(1)
    await env.jobs.cancel(first.id, env.room.id)
    await untilJob(async () => {
      return (await env.jobs.repository.get(first.id)).revisions['1'].state === 'cancelled'
    }, 'Remote cancellation was not acknowledged')
    expect(mcp.state.cancels).toBe(1)
    await untilJob(() => {
      return mcp.state.submissions === 2
    }, 'Capacity was not released')
    await untilJob(async () => {
      return (await env.jobs.repository.get(second.id)).revisions['1'].external?.status === 'working'
    }, 'Second not pending')
    mcp.state.retainAcrossSessions = true
    mcp.state.sessions.clear()
    await untilJob(() => {
      return mcp.state.initializes === 4
    }, 'Remote session was not reinitialized')
    await untilJob(async () => {
      return (await env.jobs.repository.get(second.id)).revisions['1'].external?.attempts === 2
    }, 'Reattached status was not persisted')
    expect(JSON.stringify(await env.jobs.repository.get(second.id))).not.toContain('PRIVATE_MCP_SESSION')
    mcp.complete([...mcp.state.tasks.keys()][1])
    await untilJob(async () => {
      return (await env.jobs.repository.get(second.id)).revisions['1'].delivery === 'sent'
    }, 'Existing remote task was not reattached')
    expect(mcp.state.submissions).toBe(2)
    expect(mcp.state.initializes).toBe(4)
    expect(env.requests).toHaveLength(0)
  } finally {
    await env.close()
    await mcp.server.stop(true)
  }
})

test('lost cancellation receipts remain unknown until an explicit status check confirms them, without resubmitting or sending a late message', async () => {
  const mcp = mcpTaskFixture()
  mcp.state.loseCancel = true
  const env = await jobHarness(
    () => {
      throw new Error('No model request expected')
    },
    await resources(mcp)
  )
  try {
    const job = await env.jobs.start(
      env.coordinator.jobInvocation(env.room.id, localIdentity('mock', 'mock-bot'), 'cancel'),
      'Cancel safely',
      { kind: 'tool', capability: 'mcp:rendering/render', arguments: { prompt: 'once' } },
      'first'
    )
    await untilJob(async () => {
      return (await env.jobs.repository.get(job.id)).revisions['1'].external?.hasReceipt === true
    }, 'Missing task receipt')
    await env.jobs.cancel(job.id, env.room.id)
    await untilJob(async () => {
      return (await env.jobs.repository.get(job.id)).revisions['1'].state === 'outcome_unknown'
    }, 'Unknown cancel was misreported')
    const checked = await env.jobs.reconcile(job.id, env.room.id, false)
    expect(checked.state).toBe('cancelled')
    expect(checked.delivery).toBe('suppressed')
    expect(mcp.state.submissions).toBe(1)
    expect(mcp.state.cancels).toBe(1)
    expect(env.store.listMessages(env.room.id)).toHaveLength(0)
  } finally {
    await env.close()
    await mcp.server.stop(true)
  }
})

test('a remote task completing during cancellation preserves its result while suppressing delivery', async () => {
  const mcp = mcpTaskFixture()
  mcp.state.completeOnCancel = true
  const env = await jobHarness(
    () => {
      throw new Error('No model request expected')
    },
    await resources(mcp)
  )
  try {
    const job = await env.jobs.start(
      env.coordinator.jobInvocation(env.room.id, localIdentity('mock', 'mock-bot'), 'race'),
      'Completion race',
      { kind: 'tool', capability: 'mcp:rendering/render', arguments: { prompt: 'once' } },
      'first'
    )
    await untilJob(async () => {
      return (await env.jobs.repository.get(job.id)).revisions['1'].external?.hasReceipt === true
    }, 'Missing task receipt')
    await env.jobs.cancel(job.id, env.room.id)
    await untilJob(async () => {
      return (await env.jobs.repository.get(job.id)).revisions['1'].delivery === 'suppressed'
    }, 'Cancelled result was not suppressed')
    const result = (await env.jobs.repository.get(job.id)).revisions['1']
    expect(result.state).toBe('succeeded')
    expect(result.result?.summary).toBe('EXTERNAL_RESULT')
    expect(env.store.listMessages(env.room.id)).toHaveLength(0)
    expect(mcp.state.cancels).toBe(1)
  } finally {
    await env.close()
    await mcp.server.stop(true)
  }
})

test('read-only polling retries transient errors using the original connector snapshot after configuration changes', async () => {
  const mcp = mcpTaskFixture()
  mcp.state.failPolls = 1
  const env = await jobHarness(
    () => {
      throw new Error('No model request expected')
    },
    await resources(mcp)
  )
  try {
    const job = await env.jobs.start(
      env.coordinator.jobInvocation(env.room.id, localIdentity('mock', 'mock-bot'), 'retry'),
      'Query retry',
      { kind: 'tool', capability: 'mcp:rendering/render', arguments: { prompt: 'once' } },
      'first'
    )
    await untilJob(() => {
      return mcp.state.polls === 1
    }, 'Poll did not start')
    env.config.resources = new ResourceLibrary(
      ResourcesConfigSchema.parse({
        mcp: [{ ...mcp.config, url: 'http://127.0.0.1:9/replacement', headers: { Authorization: 'changed' } }]
      }),
      []
    )
    mcp.complete()
    await untilJob(async () => {
      return (await env.jobs.repository.get(job.id)).revisions['1'].delivery === 'sent'
    }, 'Pinned task did not recover from query failure')
    expect((await env.jobs.repository.get(job.id)).revisions['1'].state).toBe('succeeded')
    expect(mcp.state.submissions).toBe(1)
    expect(mcp.state.polls).toBe(2)
    expect(env.requests).toHaveLength(0)
  } finally {
    await env.close()
    await mcp.server.stop(true)
  }
})

test('disabling a connector stops future queries and cleans up only its already-owned task without a late group reply', async () => {
  const mcp = mcpTaskFixture()
  const env = await jobHarness(
    () => {
      throw new Error('No model request expected')
    },
    await resources(mcp)
  )
  try {
    const job = await env.jobs.start(
      env.coordinator.jobInvocation(env.room.id, localIdentity('mock', 'mock-bot'), 'revoke'),
      'Revoke service',
      { kind: 'tool', capability: 'mcp:rendering/render', arguments: { prompt: 'once' } },
      'first'
    )
    await untilJob(async () => {
      return (await env.jobs.repository.get(job.id)).revisions['1'].external?.hasReceipt === true
    }, 'Missing task receipt')
    env.config.resources = new ResourceLibrary(
      ResourcesConfigSchema.parse({ mcp: [{ ...mcp.config, enabled: false }] }),
      env.config.resources.manifests
    )
    await untilJob(async () => {
      return (await env.jobs.repository.get(job.id)).revisions['1'].delivery === 'suppressed'
    }, 'Revoked work did not stop')
    expect((await env.jobs.repository.get(job.id)).revisions['1'].state).toBe('cancelled')
    expect(mcp.state.cancels).toBe(1)
    expect(env.store.listMessages(env.room.id)).toHaveLength(0)
  } finally {
    await env.close()
    await mcp.server.stop(true)
  }
})

test('explicit protocol rejection and a terminal remote RPC failure are failures rather than unacknowledged submissions', async () => {
  const mcp = mcpTaskFixture()
  mcp.state.rejectSubmit = true
  const env = await jobHarness(
    () => {
      throw new Error('No model request expected')
    },
    await resources(mcp)
  )
  try {
    function invoke() {
      return env.coordinator.jobInvocation(env.room.id, localIdentity('mock', 'mock-bot'), 'failure')
    }
    const spec = { kind: 'tool' as const, capability: 'mcp:rendering/render', arguments: { prompt: 'once' } }
    const rejected = await env.jobs.start(invoke(), 'Rejected', spec, 'rejected')
    await untilJob(async () => {
      return (await env.jobs.repository.get(rejected.id)).revisions['1'].delivery === 'sent'
    }, 'Rejection was not reported')
    expect((await env.jobs.repository.get(rejected.id)).revisions['1'].state).toBe('failed')
    expect(mcp.state.submissions).toBe(0)
    mcp.state.rejectSubmit = false
    const failed = await env.jobs.start(invoke(), 'Failed remotely', spec, 'failed')
    await untilJob(async () => {
      return (await env.jobs.repository.get(failed.id)).revisions['1'].external?.hasReceipt === true
    }, 'Missing task receipt')
    mcp.state.failResult = true
    const remote = [...mcp.state.tasks.values()][0]
    remote.task.status = 'failed'
    await untilJob(async () => {
      return (await env.jobs.repository.get(failed.id)).revisions['1'].delivery === 'sent'
    }, 'Remote error not reported')
    expect((await env.jobs.repository.get(failed.id)).revisions['1'].state).toBe('failed')
    expect((await env.jobs.repository.get(failed.id)).revisions['1'].error).toContain('REMOTE_WORK_REJECTED')
    expect(mcp.state.results).toBe(1)
  } finally {
    await env.close()
    await mcp.server.stop(true)
  }
})

test('an elapsed remote retention hint is not mistaken for task completion or forced expiry while the receiver still retains the task', async () => {
  const mcp = mcpTaskFixture()
  mcp.state.ttl = 50
  const env = await jobHarness(
    () => {
      throw new Error('No model request expected')
    },
    await resources(mcp)
  )
  try {
    const job = await env.jobs.start(
      env.coordinator.jobInvocation(env.room.id, localIdentity('mock', 'mock-bot'), 'retention'),
      'Retained task',
      { kind: 'tool', capability: 'mcp:rendering/render', arguments: { prompt: 'once' } },
      'first'
    )
    await untilJob(() => {
      return mcp.state.polls > 0
    }, 'Receiver was not queried after its TTL hint')
    mcp.complete()
    await untilJob(async () => {
      return (await env.jobs.repository.get(job.id)).revisions['1'].delivery === 'sent'
    }, 'Retained result was discarded')
    expect((await env.jobs.repository.get(job.id)).revisions['1'].state).toBe('succeeded')
    expect(mcp.state.submissions).toBe(1)
    expect(mcp.state.polls).toBeLessThanOrEqual(3)
  } finally {
    await env.close()
    await mcp.server.stop(true)
  }
})

test('optional Tasks stay synchronous for ordinary short calls and use durable polling when explicitly started as a background operation', async () => {
  const mcp = mcpTaskFixture()
  mcp.state.taskSupport = 'optional'
  const env = await jobHarness(
    (_raw, call) => {
      if (call === 1) {
        return responsesReply({
          kind: 'tool',
          name: mcpToolName('rendering', 'render'),
          arguments: { prompt: 'quick' }
        })
      }
      return responsesReply({ kind: 'text', text: 'DIRECT_REPLY' })
    },
    await resources(mcp)
  )
  try {
    const run = await env.coordinator.receive(env.room.id, 'SHORT_QUERY')
    expect((await env.coordinator.waitRun(run!.id)).status).toBe('completed')
    expect(mcp.state.syncCalls).toBe(1)
    expect(mcp.state.submissions).toBe(0)
    expect(await env.jobs.repository.list(env.room.id)).toHaveLength(0)
    const job = await env.jobs.start(
      env.coordinator.jobInvocation(env.room.id, localIdentity('mock', 'mock-bot'), 'long'),
      'Background optional call',
      { kind: 'tool', capability: 'mcp:rendering/render', arguments: { prompt: 'long' } },
      'long'
    )
    await untilJob(async () => {
      return (await env.jobs.repository.get(job.id)).revisions['1'].external?.hasReceipt === true
    }, 'Optional task did not use the background protocol')
    mcp.complete()
    await untilJob(async () => {
      return (await env.jobs.repository.get(job.id)).revisions['1'].delivery === 'sent'
    }, 'Optional background result missing')
    expect(mcp.state.submissions).toBe(1)
    expect(mcp.state.syncCalls).toBe(1)
    expect(env.requests).toHaveLength(2)
  } finally {
    await env.close()
    await mcp.server.stop(true)
  }
})
