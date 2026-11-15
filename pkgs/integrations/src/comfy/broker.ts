import { withComfyDownload } from './budgets'
import { HistorySchema } from './outputs'
import type { Tx } from '@earendil-works/pi-durable'
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { z } from 'zod'
import type { DurableAgentRuntime } from '@pi-im-bot/agent/durable/runtime'
import type { ArtifactStore } from '@pi-im-bot/artifacts/store'
import type { JobRepository } from '@pi-im-bot/jobs/repository'
import { revision } from '@pi-im-bot/settings/resolve'
import { ComfyReceipts, ComfyActive, ReceiptSchema, type Receipt } from './documents'
import { compileWorkflow, type Parameters } from './compile'
import { comfyRevision, workflowDigest, type ComfyService, type Workflow } from './resources'
import { ComfyTransportError, comfyRequest } from './http'
import { ComfyOutputRefused } from './errors'
import { outputFiles, validateImage } from './outputs'
import type { ComfyItem } from './protocol'

export interface ComfyOwner {
  instance: string
  room: string
  job: string
  revision: number
}
const PromptSchema = z.object({ prompt_id: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/u) })
const QueueSchema = z.object({
  queue_running: z.array(z.array(z.unknown())).max(1000),
  queue_pending: z.array(z.array(z.unknown())).max(1000)
})
export class ComfyBroker {
  private readonly active = new Map<string, Promise<ComfyItem>>()
  constructor(
    private readonly runtime: DurableAgentRuntime,
    private readonly jobs: JobRepository
  ) {}
  key(owner: ComfyOwner, alias: string, item: number) {
    return revision([owner, alias, item])
  }
  private async read(key: string) {
    const doc = await this.runtime.native.snapshot(ComfyReceipts, key, BACKGROUND_CONTEXT)
    if (!doc?.value) {
      return undefined
    }
    return ReceiptSchema.parse(doc.value)
  }
  private async save(receipt: Receipt) {
    await this.runtime.native.commit(async (tx) => {
      const doc = await tx.doc(ComfyReceipts, receipt.key, null)
      const saved = ReceiptSchema.parse(receipt)
      if (doc.value?.recorded) {
        saved.recorded = true
      }
      if (doc.value?.cancelDispatched) {
        saved.cancelDispatched = true
      }
      doc.value = saved
      const activity = await tx.doc(ComfyActive)
      if (
        ['submitted', 'running'].includes(receipt.status) ||
        (receipt.status === 'outcome_unknown' && !receipt.error)
      ) {
        activity.owners[receipt.key] = { room: receipt.room, instance: receipt.instance }
      } else {
        delete activity.owners[receipt.key]
      }
      if (receipt.promptId) {
        await this.jobs.change(tx, receipt.job, receipt.revision, (job) => {
          job.external = {
            ...job.external,
            status: 'working',
            hasReceipt: true,
            attempts: job.external?.attempts ?? 0
          }
        })
      }
    }, BACKGROUND_CONTEXT)
  }
  private view(receipt: Receipt): ComfyItem {
    const result: ComfyItem = {
      recordId: receipt.key,
      attempted: receipt.dispatched,
      item: receipt.item,
      status: receipt.status,
      hasReceipt: Boolean(receipt.promptId),
      artifactIds: receipt.artifactIds,
      requestArtifactId: receipt.requestArtifactId,
      workflow: receipt.workflow,
      workflowDigest: receipt.workflowDigest
    }
    if (receipt.error !== undefined) {
      result.error = receipt.error
    }
    return result
  }
  private async exclusive(key: string, action: () => Promise<ComfyItem>): Promise<ComfyItem> {
    const previous = this.active.get(key)
    if (previous) {
      await previous.catch(() => {})
      return this.exclusive(key, action)
    }
    const promise = action()
    this.active.set(key, promise)
    try {
      return await promise
    } finally {
      if (this.active.get(key) === promise) {
        this.active.delete(key)
      }
    }
  }
  async submit(
    owner: ComfyOwner,
    alias: string,
    item: number,
    service: ComfyService,
    workflow: Workflow,
    parameters: Parameters,
    artifacts: ArtifactStore,
    signal: AbortSignal,
    authorize: () => void
  ) {
    const key = this.key(owner, alias, item)
    return this.exclusive(key, async () => {
      authorize()
      const previous = await this.read(key)
      if (previous) {
        if (
          previous.parametersDigest !== revision(parameters) ||
          previous.workflowDigest !== workflowDigest(workflow) ||
          previous.serviceRevision !== comfyRevision(service)
        ) {
          throw new Error('提交键已绑定不同的原服务/模板/参数，未重发')
        }
        return this.view(previous)
      }
      const graph = compileWorkflow(workflow, parameters)
      const payload = { prompt: graph, client_id: key }
      const store = artifacts.forOwner('comfy:' + key + ':request')
      const existing = await store.owned('comfy:' + key + ':request')
      let request = existing[0]
      if (!request) {
        request = await store.save(
          'comfy-request.json',
          'application/json',
          'comfy-request:' + key,
          JSON.stringify(payload)
        )
      }
      const receipt: Receipt = {
        ...owner,
        item,
        key,
        service: structuredClone(service),
        serviceRevision: comfyRevision(service),
        workflow: workflow.id,
        workflowDigest: workflowDigest(workflow),
        parametersDigest: revision(parameters),
        outputs: workflow.outputs,
        status: 'outcome_unknown',
        recorded: false,
        dispatched: false,
        requestArtifactId: request.id,
        artifactIds: [],
        cancelDispatched: false,
        createdAt: Date.now()
      }
      await this.runtime.native.commit(async (tx) => {
        authorize()
        const doc = await tx.doc(ComfyReceipts, key, null)
        if (doc.value) {
          throw new Error('提交已登记，未重复POST')
        }
        const activity = await tx.doc(ComfyActive)
        const entries = Object.values(activity.owners)
        if (
          entries.length >= 128 ||
          entries.filter((entry) => {
            return entry.room === owner.room
          }).length >= 32
        ) {
          throw new Error('Comfy活动任务额度已满，未提交')
        }
        doc.value = receipt
        activity.owners[key] = { room: owner.room, instance: owner.instance }
      }, BACKGROUND_CONTEXT)
      try {
        signal.throwIfAborted()
        authorize()
        const response = await comfyRequest(service, 'prompt', signal, 65536, payload, async () => {
          receipt.dispatched = true
          await this.save(receipt)
        })
        receipt.promptId = PromptSchema.parse(JSON.parse(response.bytes.toString('utf8'))).prompt_id
        receipt.status = 'submitted'
        // Save the remote ID before returning across RPC or depending on a Worker checkpoint.
        await this.save(receipt)
        signal.throwIfAborted()
        authorize()
        return this.view(receipt)
      } catch (error) {
        if (receipt.promptId) {
          throw error
        }
        if (error instanceof ComfyTransportError && error.outcome === 'rejected') {
          receipt.status = 'failed'
          receipt.error = 'Comfy明确拒绝本次提交'
        } else {
          receipt.error = '提交结果未知，未自动重提'
        }
        await this.save(receipt)
        signal.throwIfAborted()
        authorize()
        return this.view(receipt)
      }
    })
  }
  async record(tx: Tx, owner: ComfyOwner, alias: string, item: number) {
    const doc = await tx.doc(ComfyReceipts, this.key(owner, alias, item), null)
    if (!doc.value || !doc.value.dispatched) {
      throw new Error('没有实际派发尝试，不能登记提交JSON')
    }
    if (doc.value.recorded) {
      return false
    }
    doc.value.recorded = true
    return true
  }
  async inspect(
    owner: ComfyOwner,
    alias: string,
    item: number,
    action: 'recover' | 'poll' | 'cancel' | 'reconcile' | 'peek',
    artifacts: ArtifactStore,
    signal: AbortSignal,
    authorize: (receipt: Receipt) => void,
    reconcile = false
  ) {
    const key = this.key(owner, alias, item)
    return this.exclusive(key, async () => {
      const receipt = await this.read(key)
      if (!receipt) {
        return { item, status: 'not_started', attempted: false, hasReceipt: false, artifactIds: [] }
      }
      authorize(receipt)
      if (action === 'peek') {
        return this.view(receipt)
      }
      if (
        !receipt.promptId ||
        ['succeeded', 'failed', 'cancelled'].includes(receipt.status) ||
        (receipt.status === 'abandoned' && !reconcile)
      ) {
        return this.view(receipt)
      }
      if (action === 'cancel') {
        if (receipt.cancelDispatched) {
          return this.view(receipt)
        }
        const queue = QueueSchema.parse(
          JSON.parse(
            (
              await comfyRequest(receipt.service, 'queue', signal, receipt.service.maxHistoryBytes)
            ).bytes.toString('utf8')
          )
        )
        const pending = queue.queue_pending.some((row) => {
          return row[1] === receipt.promptId
        })
        const running = queue.queue_running.some((row) => {
          return row[1] === receipt.promptId
        })
        receipt.cancelDispatched = true
        receipt.status = 'abandoned'
        receipt.error = '已停止本地等待；远端运行结果未确认'
        await this.save(receipt)
        if (pending && !running) {
          authorize(receipt)
          try {
            await comfyRequest(receipt.service, 'queue', signal, 65536, { delete: [receipt.promptId] })
            const after = QueueSchema.parse(
              JSON.parse(
                (
                  await comfyRequest(receipt.service, 'queue', signal, receipt.service.maxHistoryBytes)
                ).bytes.toString('utf8')
              )
            )
            const history = HistorySchema.parse(
              JSON.parse(
                (
                  await comfyRequest(
                    receipt.service,
                    'history/' + encodeURIComponent(receipt.promptId),
                    signal,
                    receipt.service.maxHistoryBytes
                  )
                ).bytes.toString('utf8')
              )
            )
            const present = [...after.queue_pending, ...after.queue_running].some((row) => {
              return row[1] === receipt.promptId
            })
            if (!present && !history[receipt.promptId]) {
              receipt.status = 'cancelled'
              receipt.error = undefined
            } else {
              receipt.error = '删除时任务已运行或完成；仅停止本地等待，保留事实核对'
            }
            await this.save(receipt)
          } catch {
            /* Never repeat an uncertain delete. */
          }
        }
        return this.view(receipt)
      }
      try {
        const history = await comfyRequest(
          receipt.service,
          'history/' + encodeURIComponent(receipt.promptId),
          signal,
          receipt.service.maxHistoryBytes
        )
        const output = outputFiles(
          JSON.parse(history.bytes.toString('utf8')),
          receipt.promptId,
          receipt.outputs
        )
        authorize(receipt)
        if (output.status === 'failed') {
          receipt.status = 'failed'
          receipt.error = '本任务远端执行失败'
        } else if (output.status === 'running') {
          receipt.status = 'running'
        } else {
          const ids: string[] = []
          for (const [index, file] of output.files.entries()) {
            signal.throwIfAborted()
            authorize(receipt)
            const store = artifacts.forOwner('comfy:' + key + ':output:' + index)
            const prior = await store.owned('comfy:' + key + ':output:' + index)
            let artifact = prior[0]
            if (!artifact) {
              artifact = await withComfyDownload(receipt.service, signal, async (bounded) => {
                const query = new URLSearchParams(file)
                const image = await comfyRequest(
                  receipt.service,
                  'view?' + query.toString(),
                  bounded,
                  receipt.service.maxImageBytes
                )
                validateImage(image.bytes, image.mimeType)
                authorize(receipt)
                const result = await store.save(
                  file.filename,
                  image.mimeType!,
                  'comfy-output:' + key + ':' + index,
                  image.bytes
                )
                bounded.throwIfAborted()
                return result
              })
            }
            ids.push(artifact.id)
          }
          receipt.artifactIds = ids
          receipt.status = 'succeeded'
        }
        await this.save(receipt)
        signal.throwIfAborted()
        authorize(receipt)
        return this.view(receipt)
      } catch (error) {
        signal.throwIfAborted()
        authorize(receipt)
        if (
          error instanceof ComfyOutputRefused ||
          error instanceof z.ZodError ||
          (error instanceof ComfyTransportError && error.outcome === 'refused')
        ) {
          receipt.status = 'failed'
          receipt.error = '指定输出未通过路径、格式或体积校验'
        } else {
          receipt.status = 'outcome_unknown'
          receipt.error = '原prompt_id的结果暂不可核对；保留回执，不重提'
        }
        await this.save(receipt)
        return this.view(receipt)
      }
    })
  }
}
