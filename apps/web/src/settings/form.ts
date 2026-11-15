import { element } from '../dom'
import type { Snapshot, FrameworkEditorState } from '@pi-im-bot/contracts/http'
import {
  SettingsPatchSchema,
  PermissionPolicySchema,
  ResourceSelectionSchema,
  type SettingsPatch,
  type Settings
} from '@pi-im-bot/settings/schema'
import { booleanInput, overrideControl, selectOptions } from './controls'

export function settingsForm(
  patch: SettingsPatch,
  effective: Settings,
  sources: Record<string, string>,
  defaults: boolean,
  snapshot: Snapshot,
  library: FrameworkEditorState
) {
  const root = element('div', 'settings-grid')
  function source(path: string) {
    if (defaults) {
      return '默认'
    }
    return sources[path] ?? '继承上级'
  }
  const personaInput = selectOptions(
    library.config.personas,
    patch.preferences?.personaId ?? effective.preferences.personaId
  )
  const persona = overrideControl(
    '人格',
    personaInput,
    patch.preferences?.personaId,
    defaults,
    source('preferences.personaId'),
    () => {
      return personaInput.value
    }
  )
  const groupInput = selectOptions(
    snapshot.providers.groups,
    patch.preferences?.providerGroup ?? effective.preferences.providerGroup
  )
  const group = overrideControl(
    '默认模型组',
    groupInput,
    patch.preferences?.providerGroup,
    defaults,
    source('preferences.providerGroup'),
    () => {
      return groupInput.value
    }
  )
  const styleInput = element('textarea')
  styleInput.rows = 3
  styleInput.value = patch.preferences?.replyStyle ?? effective.preferences.replyStyle
  const style = overrideControl(
    '回复偏好',
    styleInput,
    patch.preferences?.replyStyle,
    defaults,
    source('preferences.replyStyle'),
    () => {
      return styleInput.value
    }
  )

  function bool(label: string, path: string, value: boolean | undefined, resolved: boolean) {
    const input = booleanInput(value ?? resolved)
    return overrideControl(label, input, value, defaults, source(path), () => {
      return input.value === 'true'
    })
  }
  function number(
    label: string,
    path: string,
    value: number | undefined,
    resolved: number,
    min: number,
    max: number
  ) {
    const input = element('input')
    input.type = 'number'
    input.min = String(min)
    input.max = String(max)
    input.value = String(value ?? resolved)
    return overrideControl(label, input, value, defaults, source(path), () => {
      return Number(input.value)
    })
  }
  const speaker = bool(
    '发言者信息',
    'data.includeSpeaker',
    patch.data?.includeSpeaker,
    effective.data.includeSpeaker
  )
  const time = bool('消息时间', 'data.includeTime', patch.data?.includeTime, effective.data.includeTime)
  const limit = number(
    '历史读取上限（条）',
    'data.historyLimit',
    patch.data?.historyLimit,
    effective.data.historyLimit,
    1,
    100
  )
  const chars = number(
    '历史正文预算（字符）',
    'data.historyChars',
    patch.data?.historyChars,
    effective.data.historyChars,
    500,
    100000
  )
  const enabled = bool(
    'Agent 响应',
    'behavior.agentEnabled',
    patch.behavior?.agentEnabled,
    effective.behavior.agentEnabled
  )
  const proactive = bool(
    '允许主动发送工具',
    'behavior.allowProactive',
    patch.behavior?.allowProactive,
    effective.behavior.allowProactive
  )
  const timeout = number(
    '任务超时（毫秒）',
    'behavior.timeoutMs',
    patch.behavior?.timeoutMs,
    effective.behavior.timeoutMs,
    1000,
    3600000
  )
  const calls = number(
    '模型调用上限',
    'behavior.maxModelCalls',
    patch.behavior?.maxModelCalls,
    effective.behavior.maxModelCalls,
    1,
    100
  )
  const trim = bool('去除回复首尾空白', 'output.trim', patch.output?.trim, effective.output.trim)

  function section(title: string, nodes: HTMLElement[]) {
    const card = element('section', 'card settings-section')
    card.append(element('h2', '', title), ...nodes)
    root.append(card)
  }
  section('共享偏好', [persona.node, group.node, style.node])
  section('数据与输出', [speaker.node, time.node, limit.node, chars.node, trim.node])
  const quotes = bool(
    '引用消息内容',
    'data.includeQuotes',
    patch.data?.includeQuotes,
    effective.data.includeQuotes
  )
  const quoteChars = number(
    '引用正文预算（字符）',
    'data.quoteChars',
    patch.data?.quoteChars,
    effective.data.quoteChars,
    0,
    8000
  )
  const vision = bool(
    '本轮图片视觉投影',
    'data.visionEnabled',
    patch.data?.visionEnabled,
    effective.data.visionEnabled
  )
  const imageCount = number(
    '每次请求最多图片数',
    'data.imageMaxCount',
    patch.data?.imageMaxCount,
    effective.data.imageMaxCount,
    1,
    8
  )
  const imageSide = number(
    '图片投影最长边（像素）',
    'data.imageMaxSide',
    patch.data?.imageMaxSide,
    effective.data.imageMaxSide,
    256,
    4096
  )
  const imageBytes = number(
    '图片投影总预算（Base64 字节）',
    'data.imageBudgetBytes',
    patch.data?.imageBudgetBytes,
    effective.data.imageBudgetBytes,
    65536,
    16777216
  )
  section('媒体与引用', [
    quotes.node,
    quoteChars.node,
    vision.node,
    imageCount.node,
    imageSide.node,
    imageBytes.node,
    element(
      'p',
      'muted',
      '只为当前请求载入图片，历史保留引用。后续可用 media_read 按需重看；不会为描述图片额外调用一个模型。'
    )
  ])
  section('行为', [enabled.node, proactive.node, timeout.node, calls.node])
  const quiet = number(
    '发言安静窗口（毫秒，0 关闭合批）',
    'behavior.batchQuietMs',
    patch.behavior?.batchQuietMs,
    effective.behavior.batchQuietMs,
    0,
    5000
  )
  const hold = number(
    '合批最长等待（毫秒）',
    'behavior.batchMaxHoldMs',
    patch.behavior?.batchMaxHoldMs,
    effective.behavior.batchMaxHoldMs,
    50,
    10000
  )
  const requests = number(
    '每批最多发言数',
    'behavior.batchMaxRequests',
    patch.behavior?.batchMaxRequests,
    effective.behavior.batchMaxRequests,
    1,
    20
  )
  const batchChars = number(
    '合批正文预算（字符）',
    'behavior.batchMaxChars',
    patch.behavior?.batchMaxChars,
    effective.behavior.batchMaxChars,
    500,
    100000
  )
  const queueAge = number(
    '排队请求有效期（毫秒）',
    'behavior.queueMaxAgeMs',
    patch.behavior?.queueMaxAgeMs,
    effective.behavior.queueMaxAgeMs,
    1000,
    3600000
  )
  section('合批与排队', [
    element(
      'p',
      'muted',
      '群内成员共享同一个窗口，权限取共同允许的范围。指令直接处理。过期的排队请求保留记录，不再自动补发旧回答。'
    ),
    quiet.node,
    hold.node,
    requests.node,
    batchChars.node,
    queueAge.node
  ])
  const jobLimit = number(
    '每轮后台任务上限',
    'behavior.maxJobsPerRun',
    patch.behavior?.maxJobsPerRun,
    effective.behavior.maxJobsPerRun,
    1,
    10
  )
  const jobTimeout = number(
    '后台任务期限（毫秒）',
    'behavior.jobTimeoutMs',
    patch.behavior?.jobTimeoutMs,
    effective.behavior.jobTimeoutMs,
    1000,
    86400000
  )
  const outstandingJobs = number(
    '此会话未收尾任务上限',
    'behavior.maxOutstandingJobs',
    patch.behavior?.maxOutstandingJobs,
    effective.behavior.maxOutstandingJobs,
    1,
    200
  )
  section('后台工作', [
    jobLimit.node,
    outstandingJobs.node,
    jobTimeout.node,
    element(
      'p',
      'muted',
      '后台 Agent 使用独立对话和沙盒，同群模型请求按前台 1 + 后台 1 调度。等待外部操作不占模型额度。'
    )
  ])

  const toolsInput = element('textarea')
  toolsInput.rows = 5
  toolsInput.value = JSON.stringify(patch.resources?.tools ?? effective.resources.tools, null, 2)
  const tools = overrideControl(
    '工具选择（JSON）',
    toolsInput,
    patch.resources?.tools,
    defaults,
    source('resources.tools'),
    () => {
      return ResourceSelectionSchema.parse(JSON.parse(toolsInput.value))
    }
  )
  const policyInput = element('textarea')
  policyInput.rows = 9
  policyInput.value = JSON.stringify(patch.permissions ?? effective.permissions, null, 2)
  const permissions = overrideControl(
    '调用权限（JSON）',
    policyInput,
    patch.permissions,
    defaults,
    source('permissions'),
    () => {
      return PermissionPolicySchema.parse(JSON.parse(policyInput.value))
    }
  )
  const mcpInput = element('textarea')
  mcpInput.rows = 3
  mcpInput.value = JSON.stringify(patch.resources?.mcp ?? effective.resources.mcp, null, 2)
  const mcp = overrideControl(
    'MCP 服务选择（JSON）',
    mcpInput,
    patch.resources?.mcp,
    defaults,
    source('resources.mcp'),
    () => {
      return ResourceSelectionSchema.parse(JSON.parse(mcpInput.value))
    }
  )
  const skillsInput = element('textarea')
  skillsInput.rows = 3
  skillsInput.value = JSON.stringify(patch.resources?.skills ?? effective.resources.skills, null, 2)
  const skills = overrideControl(
    'Skill 选择（JSON）',
    skillsInput,
    patch.resources?.skills,
    defaults,
    source('resources.skills'),
    () => {
      return ResourceSelectionSchema.parse(JSON.parse(skillsInput.value))
    }
  )
  const exposureInput = selectOptions(
    [
      { id: 'all', name: '全量装载' },
      { id: 'deferred', name: 'Pi 按需搜索与装载' }
    ],
    patch.resources?.toolExposure ?? effective.resources.toolExposure
  )
  const exposure = overrideControl(
    '工具收纳策略',
    exposureInput,
    patch.resources?.toolExposure,
    defaults,
    source('resources.toolExposure'),
    () => {
      if (exposureInput.value === 'deferred') {
        return 'deferred' as const
      }
      return 'all' as const
    }
  )
  const permanentInput = element('input')
  permanentInput.value = (patch.resources?.permanentTools ?? effective.resources.permanentTools).join(', ')
  const permanent = overrideControl(
    '常驻工具（逗号分隔）',
    permanentInput,
    patch.resources?.permanentTools,
    defaults,
    source('resources.permanentTools'),
    () => {
      return permanentInput.value
        .split(',')
        .map((value) => {
          return value.trim()
        })
        .filter(Boolean)
    }
  )
  const idle = number(
    '工具闲置保留轮数',
    'resources.idleToolTurns',
    patch.resources?.idleToolTurns,
    effective.resources.idleToolTurns,
    0,
    50
  )
  section('能力与权限', [
    element(
      'p',
      'muted',
      '每个对话只使用一种收纳策略。工具选择 all 表示全部已注册工具；selected + ids 表示指定集合，空数组表示关闭全部业务工具。'
    ),
    exposure.node,
    permanent.node,
    idle.node,
    mcp.node,
    skills.node,
    element('p', 'muted', '插件范围、配置继承和执行顺序请在「插件中心」中管理。'),
    tools.node,
    element(
      'p',
      'muted',
      library.capabilities
        .map((item) => {
          return `${item.id}：${item.name}`
        })
        .join('；')
    ),
    permissions.node,
    element(
      'p',
      'muted',
      '拒绝规则优先。身份来自平台事件；网页模拟昵称和 ID 不会取得 QQ 权限。权限变更会在下一次工具调用检查。'
    )
  ])
  return {
    node: root,
    read(): SettingsPatch {
      // JSON removes absent overrides. Empty strings and selected empty lists stay explicit.
      return SettingsPatchSchema.parse(
        JSON.parse(
          JSON.stringify({
            preferences: { personaId: persona.read(), providerGroup: group.read(), replyStyle: style.read() },
            data: {
              includeQuotes: quotes.read(),
              quoteChars: quoteChars.read(),
              visionEnabled: vision.read(),
              imageMaxCount: imageCount.read(),
              imageMaxSide: imageSide.read(),
              imageBudgetBytes: imageBytes.read(),
              includeSpeaker: speaker.read(),
              includeTime: time.read(),
              historyLimit: limit.read(),
              historyChars: chars.read()
            },
            behavior: {
              agentEnabled: enabled.read(),
              allowProactive: proactive.read(),
              timeoutMs: timeout.read(),
              maxModelCalls: calls.read(),
              batchQuietMs: quiet.read(),
              batchMaxHoldMs: hold.read(),
              batchMaxRequests: requests.read(),
              batchMaxChars: batchChars.read(),
              queueMaxAgeMs: queueAge.read(),
              maxJobsPerRun: jobLimit.read(),
              maxOutstandingJobs: outstandingJobs.read(),
              jobTimeoutMs: jobTimeout.read()
            },
            output: { trim: trim.read() },
            resources: {
              tools: tools.read(),
              mcp: mcp.read(),
              skills: skills.read(),
              plugins: patch.resources?.plugins,
              toolExposure: exposure.read(),
              permanentTools: permanent.read(),
              idleToolTurns: idle.read()
            },
            permissions: permissions.read(),
            extensions: {
              priorities: patch.extensions?.priorities,
              disabled: patch.extensions?.disabled,
              settings: patch.extensions?.settings
            }
          })
        )
      )
    }
  }
}
