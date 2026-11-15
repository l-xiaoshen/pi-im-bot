import { z } from 'zod'
export const LogicalMessageSchema = z
  .object({ text: z.string().max(20000).default(''), artifactIds: z.array(z.uuid()).max(8).default([]) })
  .strict()
export const SendMessageInputSchema = z.union([
  LogicalMessageSchema.refine(
    (value) => value.text.length > 0 || value.artifactIds.length > 0,
    '消息和产物不能同时为空'
  ),
  z.object({ messages: z.array(LogicalMessageSchema) }).strict()
])
export function logicalMessages(input: z.infer<typeof SendMessageInputSchema>) {
  if ('messages' in input) {
    return input.messages.filter((item) => item.text.length > 0 || item.artifactIds.length > 0)
  }
  return [input]
}
