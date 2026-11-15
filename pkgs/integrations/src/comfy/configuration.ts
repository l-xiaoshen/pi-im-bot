import { z } from 'zod'
import { ComfyServiceSchema, WorkflowSchema, workflowDigest, type ComfyService } from './resources'
const Placeholder = '__PI_IM_BOT_SECRET_PRESERVED__'
export const ComfyDraftSchema = ComfyServiceSchema.omit({ url: true }).extend({ url: z.string().default('') })
export const ComfyViewSchema = ComfyServiceSchema.omit({ url: true }).extend({ endpoint: z.string() })
export const SaveComfySchema = z.object({ revision: z.string(), service: ComfyDraftSchema }).strict()
export const SaveWorkflowSchema = z.object({ revision: z.string(), workflow: WorkflowSchema }).strict()
export const WorkflowViewSchema = z
  .object({
    id: WorkflowSchema.shape.id,
    name: WorkflowSchema.shape.name,
    description: WorkflowSchema.shape.description,
    digest: z.string(),
    modelCount: z.number(),
    loraCount: z.number(),
    parameterCount: z.number()
  })
  .strict()
export function comfyPublic(service: ComfyService) {
  const { url, headers, ...rest } = service
  return {
    ...rest,
    endpoint: url,
    headers: Object.fromEntries(
      Object.keys(headers).map((name) => {
        return [name, Placeholder]
      })
    )
  }
}
export function comfyFromDraft(draft: z.infer<typeof ComfyDraftSchema>, previous?: ComfyService) {
  const headers = Object.fromEntries(
    Object.entries(draft.headers).map(([name, value]) => {
      if (value !== Placeholder) {
        return [name, value]
      }
      const old = Object.entries(previous?.headers ?? {}).find(([key]) => {
        return key.toLowerCase() === name.toLowerCase()
      })
      if (!old) {
        throw new Error('Header占位没有可保留的值')
      }
      return [name, old[1]]
    })
  )
  return ComfyServiceSchema.parse({ ...draft, url: draft.url || previous?.url, headers })
}
export function workflowPublic(workflow: z.infer<typeof WorkflowSchema>) {
  return {
    id: workflow.id,
    name: workflow.name,
    description: workflow.description,
    digest: workflowDigest(workflow),
    modelCount: workflow.models.length,
    loraCount: workflow.loras.length,
    parameterCount: Object.keys(workflow.parameters).length
  }
}
