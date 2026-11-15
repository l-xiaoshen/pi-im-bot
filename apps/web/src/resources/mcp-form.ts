import { z } from 'zod'
import { element, field, showDialog } from '../dom'
import { McpServerDraftSchema, type McpServerDraft, type McpServerView } from '@pi-im-bot/resources/contracts'

const HeadersSchema = z.record(z.string(), z.string())

export function editMcp(server: McpServerView | undefined, save: (server: McpServerDraft) => Promise<void>) {
  const id = element('input')
  id.required = true
  id.pattern = '[a-z][a-z0-9_]{0,23}'
  id.value = server?.id ?? ''
  id.disabled = Boolean(server)
  id.placeholder = '例如 web_search'
  const name = element('input')
  name.required = true
  name.value = server?.name ?? ''
  const url = element('input')
  url.type = 'url'
  url.autocomplete = 'off'
  url.placeholder = 'https://example.com/mcp'
  if (server) {
    url.placeholder = '留空保留：' + server.endpoint
  }
  const enabled = element('select')
  enabled.setAttribute('aria-label', '状态')
  for (const [value, label] of [
    ['false', '停用'],
    ['true', '启用']
  ]) {
    const option = element('option', '', label)
    option.value = value
    enabled.append(option)
  }
  enabled.value = String(server?.enabled ?? false)
  const headers = element('textarea')
  headers.rows = 5
  headers.value = JSON.stringify(server?.headers ?? {}, null, 2)
  const env = element('textarea')
  env.rows = 3
  env.value = JSON.stringify(server?.headerEnv ?? {}, null, 2)
  const timeout = element('input')
  timeout.type = 'number'
  timeout.min = '1000'
  timeout.max = '300000'
  timeout.value = String(server?.timeoutMs ?? 60000)
  const tasks = element('select')
  for (const [value, label] of [
    ['auto', '按服务声明使用持久后台任务'],
    ['off', '关闭 Tasks（必需 Tasks 的工具将不装载）']
  ]) {
    const option = element('option', '', label)
    option.value = value
    tasks.append(option)
  }
  tasks.value = server?.tasks.mode ?? 'auto'
  const automatic = element('select')
  for (const [value, label] of [
    ['required', '仅强制 Tasks 的工具自动转后台'],
    ['supported', '支持 Tasks 的工具都自动转后台']
  ]) {
    const option = element('option', '', label)
    option.value = value
    automatic.append(option)
  }
  automatic.value = server?.tasks.automatic ?? 'required'
  const poll = element('input')
  poll.type = 'number'
  poll.min = '250'
  poll.max = '300000'
  poll.value = String(server?.tasks.pollIntervalMs ?? 2000)
  const capacity = element('input')
  capacity.type = 'number'
  capacity.min = '1'
  capacity.max = '100'
  capacity.value = String(server?.tasks.maxPending ?? 4)
  const failures = element('input')
  failures.type = 'number'
  failures.min = '1'
  failures.max = '20'
  failures.value = String(server?.tasks.maxPollFailures ?? 5)
  showDialog(
    'MCP 服务',
    [
      field('服务 ID', id),
      field('名称', name),
      field('HTTP MCP 地址', url),
      field('状态', enabled),
      field('Headers（JSON）', headers),
      element(
        'small',
        'muted',
        '保留占位符即保留已保存的值；删除字段即清除。所有值都按字面传送，不执行命令或隐式读取环境变量。'
      ),
      field('Header 环境变量映射（JSON）', env),
      field('调用期限（毫秒）', timeout),
      field('MCP Tasks', tasks),
      field('自动后台策略', automatic),
      field('默认轮询间隔（毫秒）', poll),
      field('此服务等待中的远端任务上限', capacity),
      field('连续查询失败上限', failures),
      element(
        'small',
        'muted',
        '仅对声明 MCP Tasks 的工具生效；轮询遵守服务返回的建议间隔。此上限控制宿主等待的任务数量，不代表远端 GPU 配额。'
      )
    ],
    '保存 MCP',
    async () => {
      await save(
        McpServerDraftSchema.parse({
          id: id.value,
          name: name.value,
          url: url.value,
          enabled: enabled.value === 'true',
          transport: 'http',
          headers: HeadersSchema.parse(JSON.parse(headers.value)),
          headerEnv: HeadersSchema.parse(JSON.parse(env.value)),
          timeoutMs: Number(timeout.value),
          tasks: {
            mode: tasks.value,
            automatic: automatic.value,
            pollIntervalMs: Number(poll.value),
            maxPending: Number(capacity.value),
            maxPollFailures: Number(failures.value)
          }
        })
      )
    }
  )
}
