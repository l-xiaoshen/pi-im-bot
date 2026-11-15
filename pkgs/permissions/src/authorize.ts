import type { BotTool } from '@pi-im-bot/capabilities/tool'
import type { EffectiveSettings, PermissionPolicy, Settings } from '@pi-im-bot/settings/schema'
import type { Authority, TriggerIdentity } from './identity'
import { capabilityIds, isActionCapability } from './catalog'

function subjectMatches(
  subject: PermissionPolicy['rules'][number]['subjects'][number],
  identity: TriggerIdentity
) {
  if (subject.kind === 'everyone') {
    return true
  }
  if (subject.kind === 'local' || subject.kind === 'mock') {
    return subject.kind === identity.origin
  }
  if (
    identity.origin !== 'platform' ||
    subject.channel !== identity.channel ||
    subject.accountId !== identity.accountId
  ) {
    return false
  }
  if (subject.kind === 'platform-user') {
    return subject.actorId === identity.actorId
  }
  return subject.role === identity.role
}

export function isAllowed(settings: Settings, identity: TriggerIdentity, capability: string) {
  if (identity.origin === 'legacy') {
    return false
  }
  const selection = settings.resources.tools
  if (
    !capability.startsWith('command:') &&
    !capability.startsWith('hook:') &&
    !isActionCapability(capability) &&
    capability !== 'tool_search' &&
    selection.mode === 'selected' &&
    !selection.ids.includes(capability)
  ) {
    return false
  }
  if (capability === 'chat_send' && !settings.behavior.allowProactive) {
    return false
  }
  const matching = settings.permissions.rules.filter((rule) => {
    return (
      rule.capabilities.some((pattern) => {
        return (
          pattern === '*' ||
          pattern === capability ||
          ((pattern.startsWith('mcp:') ||
            pattern.startsWith('plugin:') ||
            pattern.startsWith('hook:plugin:') ||
            pattern.startsWith('command:plugin:')) &&
            pattern.endsWith('/*') &&
            capability.startsWith(pattern.slice(0, -1)))
        )
      }) &&
      rule.subjects.some((subject) => {
        return subjectMatches(subject, identity)
      })
    )
  })
  if (
    matching.some((rule) => {
      return rule.effect === 'deny'
    })
  ) {
    return false
  }
  if (capability === 'comfy_manage') {
    return (
      identity.origin !== 'mock' &&
      matching.some((rule) => {
        return rule.effect === 'allow' && rule.capabilities.includes('comfy_manage')
      })
    )
  }
  return (
    settings.permissions.default === 'allow' ||
    matching.some((rule) => {
      return rule.effect === 'allow'
    })
  )
}

export function captureAuthority(
  effective: EffectiveSettings,
  identities: readonly TriggerIdentity[],
  ceiling?: readonly string[],
  registered: readonly string[] = capabilityIds()
): Authority {
  if (identities.length === 0) {
    throw new Error('任务缺少可信触发来源')
  }
  const capabilities = registered.filter((id) => {
    return (
      (!ceiling || ceiling.includes(id)) &&
      identities.every((identity) => {
        return isAllowed(effective.settings, identity, id)
      })
    )
  })
  return { identities: structuredClone([...identities]), capabilities, policyRevision: effective.revision }
}

export function assertCapability(authority: Authority, current: Settings, capability: string) {
  if (
    !authority.capabilities.includes(capability) ||
    !authority.identities.every((identity) => {
      return isAllowed(current, identity, capability)
    })
  ) {
    throw new Error(`当前触发来源无权执行：${capability}`)
  }
}

export function authorizedTools(
  tools: BotTool[],
  authority: Authority,
  check: (capability: string) => void,
  capabilityFor: (name: string) => string = (name) => {
    return name
  }
): BotTool[] {
  return tools
    .filter((tool) => {
      return authority.capabilities.includes(capabilityFor(tool.name))
    })
    .map((tool) => {
      return {
        ...tool,
        async execute(...args: Parameters<BotTool['execute']>) {
          check(capabilityFor(tool.name))
          return tool.execute(...args)
        }
      }
    })
}
