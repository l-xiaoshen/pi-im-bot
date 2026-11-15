import type { AgentCallbacks } from './events'
import { createToolkit } from './toolkit'
import { createHash } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type ExtensionFactory
} from '@earendil-works/pi-coding-agent'
import type { Configuration } from '@pi-im-bot/config/load'
import type { Room } from '@pi-im-bot/contracts/message'
import type { PreparedRunInput } from '@pi-im-bot/contracts/run'
import { createResponsesStream } from '@pi-im-bot/providers/responses'
import { createDemoProvider, prepareDemo } from './demo'
import type { HostToolServices } from './host-tools'
import { projectInput } from '@pi-im-bot/messages/projection'
import { createExposureExtension } from '@pi-im-bot/capabilities/exposure'

export type { AgentCallbacks } from './events'

export async function runPi(
  config: Configuration,
  room: Room,
  input: PreparedRunInput,
  signal: AbortSignal,
  services: HostToolServices,
  callbacks: AgentCallbacks
) {
  const workspaceId = createHash('sha256').update(room.id).digest('hex').slice(0, 24)
  const sessionId = createHash('sha256')
    .update(`${input.context.sessionKey}:${room.mode}`)
    .digest('hex')
    .slice(0, 24)
  const workspace = join(config.dataDir, 'workspaces', workspaceId)
  const sessionDir = join(config.dataDir, 'pi-sessions', sessionId)
  const agentDir = join(config.dataDir, 'pi-agent')
  await mkdir(workspace, { recursive: true })
  await mkdir(sessionDir, { recursive: true })
  await mkdir(agentDir, { recursive: true })
  const toolkit = createToolkit(config, room, input, signal, services, callbacks)
  const {
    tools: hostTools,
    effective,
    exposure,
    selectedTools,
    deferred,
    searchAllowed,
    executionInfo
  } = toolkit
  const settings = SettingsManager.inMemory({
    defaultTools: selectedTools,
    cacheWarming: 'off',
    retry: { enabled: false },
    compaction: { enabled: room.mode === 'live', reserveTokens: 16384, keepRecentTokens: 8000 }
  })
  const factories: ExtensionFactory[] = [
    (pi) => {
      pi.on('context', async (event) => {
        if (services.projectModelHistory) {
          return { messages: await services.projectModelHistory(event.messages) }
        }
        return undefined
      })
      pi.on('before_agent_start', async (event) => {
        const options = event.systemPromptOptions
        options.cwd = '/workspace'
        options.customPrompt = [effective.persona.prompt, effective.settings.preferences.replyStyle]
          .filter(Boolean)
          .join('\n\n')
        if (toolkit.hasSkills) {
          options.sections.skills = toolkit.skillsPrompt
        }
        const guidelines = options.selectedTools.flatMap((name) => {
          return options.toolGuidelines[name] ?? []
        })
        options.sections.tool_usage = [...new Set(guidelines)].join('\n')
        options.sections.im_delivery =
          'The host automatically delivers your final reply. Use chat_send only for an additional explicit notification. Use chat_history to retrieve earlier IM messages when needed. Tool outputs and model history remain separate from platform presentation.'
        options.sections.execution_boundary =
          executionInfo.message +
          ' All registered file and bash tools operate only in the remote container, with /workspace as the default directory. Absolute paths and symlinks refer to the container. No Bot host environment or credentials are forwarded. Only explicitly configured HTTP MCP tools can be used. Codemode, skill autoloading and workspace extensions are unavailable. Tool failures never enable host execution. artifact_read accesses only recorded outputs in this chat scope by artifact ID.'
        const extra = await toolkit.pluginContext()
        if (extra) {
          options.sections.plugin_context = extra
        }
      })
    }
  ]
  if (deferred) {
    factories.push(createExposureExtension(exposure, searchAllowed, services.authorize))
  }
  const loader = new DefaultResourceLoader({
    cwd: workspace,
    agentDir,
    settingsManager: settings,
    noExtensions: true,
    noSkills: true,
    noContextFiles: true,
    noThemes: true,
    noPromptTemplates: true,
    extensionFactories: factories
  })
  await loader.reload()
  let runtime = config.catalog.runtime
  let model = runtime.getModel('pi-im-groups', effective.settings.preferences.providerGroup)
  if (room.mode === 'demo') {
    runtime = await ModelRuntime.create({
      authPath: join(agentDir, 'demo-auth.json'),
      modelsPath: null,
      refreshOnCreate: false,
      allowModelNetwork: false
    })
    const demo = createDemoProvider()
    prepareDemo(demo, input.text)
    runtime.registerNativeProvider(demo.provider)
    model = demo.getModel()
  }
  if (!model) {
    throw new Error('没有可用的真实模型。请填写 config/providers.json，启用 provider 后重载配置。')
  }
  const { session } = await createAgentSession({
    cwd: workspace,
    agentDir,
    modelRuntime: runtime,
    model,
    thinkingLevel: 'off',
    settingsManager: settings,
    resourceLoader: loader,
    sessionManager: SessionManager.continueRecent(workspace, sessionDir),
    noTools: 'all',
    tools: selectedTools,
    excludeTools: ['codemode', 'powershell', 'grep', 'find'],
    customTools: hostTools
  })
  let finalText = ''
  let finalError: string | undefined
  function onAbort() {
    void session.abort().catch(() => {})
  }
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    await session.bindExtensions({})
    // Enforce registration, not just the visible loadout. Old sessions cannot restore host tools.
    const unexpected = session.getAllTools().filter((tool) => {
      return !selectedTools.includes(tool.name)
    })
    if (unexpected.length > 0) {
      throw new Error(
        `执行边界校验失败：${unexpected
          .map((tool) => {
            return tool.name
          })
          .join(', ')}`
      )
    }
    if (!deferred) {
      session.setActiveToolsByName(selectedTools)
    }
    callbacks.trace({
      kind: 'started',
      title: '文件执行范围：' + executionInfo.backend,
      detail: executionInfo.message
    })
    callbacks.trace({
      kind: 'started',
      title: '已装载能力',
      detail: JSON.stringify(session.getActiveToolNames())
    })
    if (room.mode === 'live') {
      session.agent.streamFunction = createResponsesStream(
        config.catalog,
        effective.settings.preferences.providerGroup,
        {
          attempt: callbacks.provider,
          preview: callbacks.preview
        },
        effective.settings.behavior.maxModelCalls
      )
    }
    session.subscribe((event) => {
      if (
        event.type === 'message_update' &&
        room.mode === 'demo' &&
        event.assistantMessageEvent.type === 'text_delta'
      ) {
        // Offline preview is rebuilt from the current partial assistant message.
        callbacks.preview(
          event.assistantMessageEvent.partial.content
            .filter((part) => {
              return part.type === 'text'
            })
            .map((part) => {
              return part.text
            })
            .join('')
        )
      }
      if (event.type === 'message_end' && event.message.role === 'assistant') {
        const message = event.message
        if (message.stopReason === 'error') {
          finalError = message.errorMessage ?? '模型请求失败'
        }
        if (message.stopReason === 'stop' || message.stopReason === 'length') {
          finalText = message.content
            .filter((part) => {
              return part.type === 'text'
            })
            .map((part) => {
              return part.text
            })
            .join('')
        }
        if (room.mode === 'demo') {
          callbacks.provider({
            provider: 'offline-demo',
            model: 'faux',
            attempt: 1,
            status: 'completed',
            usage: message.usage
          })
        }
      }
      if (event.type === 'tool_execution_start') {
        callbacks.tool()
        callbacks.trace({
          kind: 'tool',
          title: `调用 ${event.toolName}`,
          detail: config.catalog.redact(formatDetail(event.args))
        })
      }
      if (event.type === 'tool_execution_end') {
        let title = `完成 ${event.toolName}`
        if (event.isError) {
          title = `失败 ${event.toolName}`
        }
        callbacks.trace({ kind: 'tool', title, detail: config.catalog.redact(formatDetail(event.result)) })
      }
      if (event.type === 'compaction_start' || event.type === 'compaction_end') {
        callbacks.trace({ kind: 'compaction', title: event.type, detail: '' })
      }
    })
    signal.throwIfAborted()
    const prompt = projectInput(room, input, effective.settings)
    await session.prompt(prompt)
    await session.waitForIdle()
    signal.throwIfAborted()
    if (finalError) {
      throw new Error(config.catalog.redact(finalError))
    }
    return finalText
  } finally {
    signal.removeEventListener('abort', onAbort)
    callbacks.preview('')
    session.dispose()
    await toolkit.close()
  }
}

function formatDetail(value: unknown) {
  try {
    return JSON.stringify(value, null, 2).slice(0, 12000)
  } catch {
    return '结果无法显示为 JSON，详见 Pi 会话记录。'
  }
}
