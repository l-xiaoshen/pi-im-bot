import { z } from 'zod'
import { element, button, field, showDialog } from '../dom'
import { mutate, request } from '../api'
import { ComfyDraftSchema, type ComfyViewSchema } from '@pi-im-bot/integrations/comfy/configuration'
import { WorkflowSchema } from '@pi-im-bot/integrations/comfy/resources'
import type { ResourcesView } from '@pi-im-bot/resources/contracts'
function jsonDialog(title: string, initial: object, save: (value: unknown) => Promise<void>) {
  const input = element('textarea')
  input.rows = 24
  input.value = JSON.stringify(initial, null, 2)
  showDialog(title, [field('受管JSON', input)], '保存', async () => {
    await save(JSON.parse(input.value))
  })
}
export function comfyResources(
  container: HTMLElement,
  library: ResourcesView,
  load: () => Promise<void>,
  notify: (error: unknown) => void
) {
  const section = element('section', 'card')
  section.append(element('h2', '', 'ComfyUI 服务与工作流'))
  section.append(
    element(
      'p',
      'muted',
      '先导入已审查的API-format模板，再登记服务并绑定模板ID；插件实例绑定comfy@1。导入不调用GPU。'
    )
  )
  function edit(service?: z.infer<typeof ComfyViewSchema>) {
    let draft: object = {
      id: 'comfy',
      name: 'ComfyUI',
      kind: 'comfy',
      enabled: false,
      url: '',
      headers: {},
      workflows: library.workflows.map((workflow) => {
        return workflow.id
      })
    }
    if (service) {
      const { endpoint: _endpoint, ...rest } = service
      draft = { ...rest, url: '' }
    }
    jsonDialog('ComfyUI具名服务', draft, async (value) => {
      const parsed = ComfyDraftSchema.parse(value)
      let path = '/api/resources/comfy'
      let method = 'POST'
      if (service) {
        path += '/' + service.id
        method = 'PUT'
      }
      await mutate(path, { revision: library.revision, service: parsed }, method)
      await load()
    })
  }
  section.append(
    button(
      '新增 ComfyUI 服务',
      () => {
        edit()
      },
      'button primary'
    )
  )
  section.append(
    button(
      '导入受管工作流',
      () => {
        jsonDialog(
          '导入已审查工作流（无网络调用）',
          {
            id: 'workflow',
            name: '已审查模板',
            description: '请粘贴dry-run生成的完整受管模板',
            graph: {},
            parameters: {},
            bindings: { positive: 'prompt', loras: [] },
            outputs: [],
            models: [],
            loras: []
          },
          async (value) => {
            await mutate('/api/resources/workflows', {
              revision: library.revision,
              workflow: WorkflowSchema.parse(value)
            })
            await load()
          }
        )
      },
      'button secondary'
    )
  )
  for (const service of library.comfyServices) {
    const card = element('section', 'card')
    let state = '已停用'
    if (service.enabled) {
      state = '已配置，可绑定；未执行连通性/GPU验证'
    }
    card.append(
      element('strong', '', service.name),
      element('p', 'muted', state + ' · ' + service.endpoint),
      element('p', '', '模板：' + service.workflows.join(', '))
    )
    card.append(
      button(
        '编辑 ComfyUI 服务',
        () => {
          edit(service)
        },
        'button secondary'
      ),
      button(
        '删除 ComfyUI 服务',
        () => {
          void mutate('/api/resources/comfy/' + service.id, { revision: library.revision }, 'DELETE')
            .then(load)
            .catch(notify)
        },
        'button secondary'
      )
    )
    section.append(card)
  }
  for (const workflow of library.workflows) {
    const card = element('section', 'card')
    card.append(
      element('strong', '', workflow.name + ' · ' + workflow.id),
      element(
        'p',
        'muted',
        '内容摘要 ' +
          workflow.digest +
          ' · ' +
          workflow.modelCount +
          '项模型声明 · ' +
          workflow.loraCount +
          '项LoRA'
      )
    )
    card.append(
      button(
        '查看/更新工作流',
        () => {
          void request(
            '/api/resources/workflows/' + workflow.id,
            z.object({ revision: z.string(), workflow: WorkflowSchema })
          )
            .then((current) => {
              jsonDialog('更新受管工作流', current.workflow, async (value) => {
                await mutate('/api/resources/workflows', {
                  revision: current.revision,
                  workflow: WorkflowSchema.parse(value)
                })
                await load()
              })
            })
            .catch(notify)
        },
        'button secondary'
      )
    )
    section.append(card)
  }
  container.append(section)
}
