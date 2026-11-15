import { requestedSkill } from '@pi-im-bot/resources/skills/invocation'
import { isJobCommand, isJobControlCommand } from '@pi-im-bot/jobs/commands'

const COMMANDS = new Set(['/help', '/status', '/stop', '/new', '/skills'])

export function isControlCommand(text: string) {
  return COMMANDS.has(text.trim()) || isJobControlCommand(text)
}

export function extractPrompt(
  text: string,
  prefix: string,
  selfId?: string,
  pluginCommand?: (text: string) => boolean
) {
  let trimmed = text.trim()
  let mentioned = false
  trimmed = trimmed.replace(/^\[CQ:reply,id=-?\d+\]\s*/u, '')
  if (selfId) {
    const mention = '[CQ:at,qq=' + selfId + ']'
    if (trimmed.startsWith(mention)) {
      trimmed = trimmed.slice(mention.length).trimStart()
      mentioned = true
    }
  }
  if (isBuiltinCommand(trimmed)) {
    return trimmed
  }
  if (pluginCommand?.(trimmed)) {
    return trimmed
  }
  if (requestedSkill(trimmed)) {
    return trimmed
  }
  if (trimmed === prefix) {
    return '/help'
  }
  if (!trimmed.startsWith(prefix) || !/\s/u.test(trimmed.charAt(prefix.length))) {
    if (mentioned) {
      return trimmed || '请查看这条消息中的附件。'
    }
    return null
  }
  return trimmed.slice(prefix.length).trim() || '/help'
}

export function isBuiltinCommand(text: string) {
  return COMMANDS.has(text.trim()) || isJobCommand(text)
}
