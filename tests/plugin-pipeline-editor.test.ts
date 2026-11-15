import { expect, test } from 'bun:test'
import { join } from 'node:path'
import { pluginConsoleFixture } from './plugin-console-fixture'
import { ResourceLibrary } from '@pi-im-bot/resources/library'
import { ResourcesConfigSchema } from '@pi-im-bot/resources/schema'
import { PluginPipelineEditor } from '@pi-im-bot/plugins/pipeline/editor'
import { PluginConfigurationEditor } from '@pi-im-bot/plugins/configuration/editor'
import { PipelineViewSchema } from '@pi-im-bot/plugins/pipeline/contracts'

test('the generated node catalog edits actual delivery order and rejects undeclared handlers and stale saves', async () => {
  const fixture = await pluginConsoleFixture()
  try {
    const bindings = []
    for (const [id, suffix] of [
      ['first', 'A'],
      ['second', 'B']
    ]) {
      bindings.push(
        await fixture.env.register(
          id,
          `export default { operations: { echo(){return {text:'base'}} }, hooks: { text(value,ctx){return {baseRevision:ctx.invocation.inputRevision,patch:[{op:'set',path:'/text',value:value.text+'${suffix}'}]}} } }`,
          {
            hooks: [{ id: 'text', point: 'delivery.text@1', mode: 'transform', writes: ['/text'] }],
            commands: [{ id: 'pipe', names: ['pipe_' + id], operation: 'echo', description: 'Owned command' }]
          }
        )
      )
    }
    fixture.app.config.bot.plugins = fixture.env.manager.config
    fixture.app.config.framework.defaults.behavior.agentEnabled = false
    fixture.app.config.resources = new ResourceLibrary(
      ResourcesConfigSchema.parse({
        plugins: bindings.map((binding) => {
          return binding.instance
        })
      }),
      [],
      [],
      bindings.map((binding) => {
        return binding.bundle
      })
    )
    await Bun.write(
      join(fixture.app.config.configDir, 'resources.json'),
      JSON.stringify(fixture.app.config.resources.config)
    )
    const pipeline = new PluginPipelineEditor(
      new PluginConfigurationEditor(fixture.editor, fixture.framework, fixture.app.coordinator)
    )
    let view = PipelineViewSchema.parse(await pipeline.read())
    expect(
      view.nodes.map((node) => {
        return node.id
      })
    ).toContain('model.history@1')
    expect(view.nodes).toHaveLength(7)
    expect(
      view.nodes.find((node) => {
        return node.id === 'delivery.text@1'
      })?.writable
    ).toEqual(['/text'])
    await fixture.app.coordinator.receive(fixture.app.room.id, '/pipe_first')
    expect(fixture.app.store.listMessages(fixture.app.room.id).at(-1)?.text).toBe('baseAB')
    const old = view.revision
    view = PipelineViewSchema.parse(
      await pipeline.save({
        revision: view.revision,
        changes: [{ key: 'second/text', priority: 100, disabled: false }]
      })
    )
    await fixture.app.coordinator.receive(fixture.app.room.id, '/pipe_first')
    expect(fixture.app.store.listMessages(fixture.app.room.id).at(-1)?.text).toBe('baseBA')
    await expect(pipeline.save({ revision: old, changes: [] })).rejects.toThrow('变化')
    await expect(
      pipeline.save({
        revision: view.revision,
        changes: [{ key: 'invented/hook', priority: 1, disabled: false }]
      })
    ).rejects.toThrow('真实节点')
    expect(fixture.app.requests).toHaveLength(0)
  } finally {
    await fixture.close()
  }
})
