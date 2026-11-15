import type { Workflow } from './resources'
import { workflowDigest } from './resources'
import type { z } from 'zod'
import type { ComfyInputSchema } from './protocol'
export function comfyCatalog(
  workflows: Workflow[],
  input: Extract<z.infer<typeof ComfyInputSchema>, { action: 'catalog' }>
) {
  const allowed = workflows.filter((workflow) => {
    return !input.workflow || workflow.id === input.workflow
  })
  if (input.section !== 'workflows' && !input.workflow) {
    throw new Error('目录详情需要明确workflow ID')
  }
  const selected = allowed[0]
  const entries: unknown[] = []
  if (input.section === 'workflows') {
    for (const workflow of allowed) {
      const { graph: _graph, parameters: _parameters, models: _models, loras: _loras, ...metadata } = workflow
      entries.push({
        ...metadata,
        digest: workflowDigest(workflow),
        parameterCount: Object.keys(workflow.parameters).length,
        modelCount: workflow.models.length,
        loraCount: workflow.loras.length
      })
    }
  } else if (selected) {
    if (input.section === 'parameters') {
      for (const [key, parameter] of Object.entries(selected.parameters)) {
        const { paths: _paths, ...definition } = parameter
        entries.push({ key, definition })
      }
    }
    if (input.section === 'models') {
      entries.push(...selected.models)
    }
    if (input.section === 'loras') {
      entries.push(...selected.loras)
    }
  }
  const items: unknown[] = []
  const start = input.cursor
  let cursor = start
  while (cursor < entries.length && items.length < 32) {
    const next = [...items, entries[cursor]]
    if (Buffer.byteLength(JSON.stringify(next)) > 196608) {
      if (!items.length) {
        throw new Error('目录单项超过192KiB，请拆分资源元数据')
      }
      break
    }
    items.push(entries[cursor])
    cursor += 1
  }
  let nextCursor: number | undefined
  if (cursor < entries.length) {
    nextCursor = cursor
  }
  const result: { items: unknown[]; total: number; nextCursor?: number } = { items, total: entries.length }
  if (nextCursor !== undefined) {
    result.nextCursor = nextCursor
  }
  return result
}
