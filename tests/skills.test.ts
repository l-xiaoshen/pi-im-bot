import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, rm, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { runPi } from '@pi-im-bot/agent/pi-runner'
import { BotConfigSchema } from '@pi-im-bot/config/schema'
import { RoomSchema } from '@pi-im-bot/contracts/message'
import { ProviderCatalog } from '@pi-im-bot/providers/catalog'
import { ProvidersConfigSchema } from '@pi-im-bot/providers/schema'
import { ResourceLibrary } from '@pi-im-bot/resources/library'
import { ResourcesConfigSchema } from '@pi-im-bot/resources/schema'
import { SkillConfigSchema } from '@pi-im-bot/resources/skills/schema'
import {
  importSkill,
  readSkillFile,
  skillGuestRoot,
  skillToolName,
  skillPackageRoot
} from '@pi-im-bot/resources/skills/package'
import { createSkillTools } from '@pi-im-bot/resources/skills/tools'
import { ArtifactStore } from '@pi-im-bot/artifacts/store'
import { captureAuthority, assertCapability } from '@pi-im-bot/permissions/authorize'
import { agentInput, testFramework } from './agent-input'
import { responsesReply } from './responses-fixture'
import { createFakeShipyard } from './shipyard-fixture'

test('Pi skill metadata and package files map to the sandbox and scripts never execute during import', async () => {
  const root = await mkdtemp('/tmp/pi-skill-test-')
  const source = join(root, 'source')
  const marker = join(root, 'host-marker')
  const bay = createFakeShipyard()
  let model: ReturnType<typeof Bun.serve> | undefined
  try {
    await mkdir(join(source, 'scripts'), { recursive: true })
    await mkdir(join(source, 'notes'), { recursive: true })
    await Bun.write(marker, 'unchanged')
    await Bun.write(
      join(source, 'SKILL.md'),
      '---\nname: report-skill\ndescription: Read reports using packaged references and scripts.\n---\nUse notes/reference.txt and scripts/work.js.\n'
    )
    await Bun.write(join(source, 'notes/reference.txt'), 'REFERENCE_FROM_SKILL')
    await Bun.write(join(source, 'scripts/work.js'), `await Bun.write(${JSON.stringify(marker)}, 'executed')`)
    const binary = new Uint8Array([0, 1, 128, 255])
    await Bun.write(join(source, 'notes/data.bin'), binary)
    const skill = SkillConfigSchema.parse({
      id: 'reports',
      name: 'Report skill',
      sourceDir: source,
      enabled: true
    })
    const manifest = await importSkill(skill, root, root)
    expect(await Bun.file(marker).text()).toBe('unchanged')
    await Bun.write(join(source, 'notes/reference.txt'), 'SOURCE_CHANGED_LATER')
    expect((await readSkillFile(root, manifest, 'notes/reference.txt')).toString()).toBe(
      'REFERENCE_FROM_SKILL'
    )
    const guest = skillGuestRoot(manifest)
    const requests: string[] = []
    let calls = 0
    model = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch(request) {
        requests.push(await request.text())
        calls += 1
        if (calls === 1) {
          return responsesReply({ kind: 'tool', name: skillToolName(skill.id), arguments: {} })
        }
        if (calls === 2) {
          return responsesReply({
            kind: 'tool',
            name: 'read',
            arguments: { path: guest + '/notes/reference.txt' }
          })
        }
        if (calls === 3) {
          return responsesReply({
            kind: 'tool',
            name: 'bash',
            arguments: { command: 'node ' + guest + '/scripts/work.js' }
          })
        }
        return responsesReply({ kind: 'text', text: 'skill completed' })
      }
    })
    const resources = new ResourceLibrary(ResourcesConfigSchema.parse({ skills: [skill] }), [], [manifest])
    const catalog = await ProviderCatalog.create(
      ProvidersConfigSchema.parse({
        defaultGroup: 'main',
        providers: [
          {
            id: 'test',
            baseUrl: `http://127.0.0.1:${model.port}/v1`,
            apiKey: 'test',
            models: [{ id: 'test' }]
          }
        ],
        groups: [{ id: 'main', candidates: [{ provider: 'test', model: 'test' }] }]
      }),
      root
    )
    const bot = BotConfigSchema.parse({
      agent: { execution: { backend: 'shipyard', endpoint: bay.endpoint, apiKey: 'test-bay-key' } }
    })
    const room = RoomSchema.parse({
      id: 'skill-scope',
      name: 'Skill scope',
      address: { channel: 'mock', accountId: 'mock-bot', kind: 'group', chatId: 'skill-scope' },
      mode: 'live',
      createdAt: 1,
      updatedAt: 1
    })
    const input = agentInput(room, 'Use report-skill')
    input.context.authority = captureAuthority(
      input.context.effective,
      input.identities,
      undefined,
      resources.capabilityIds(input.context.effective.settings)
    )
    const result = await runPi(
      {
        bot,
        catalog,
        resources,
        framework: testFramework(),
        dataDir: root,
        configDir: root,
        projectDir: root
      },
      room,
      input,
      new AbortController().signal,
      {
        authorize(id) {
          assertCapability(input.context.authority, input.context.effective.settings, id)
        },
        history() {
          return []
        },
        async send() {
          throw new Error('Unexpected send')
        }
      },
      { trace() {}, preview() {}, provider() {}, tool() {} }
    )
    expect(result).toBe('skill completed')
    expect(requests[0]).toContain(guest + '/SKILL.md')
    expect(requests.join('\n')).toContain('REFERENCE_FROM_SKILL')
    expect(requests.join('\n')).not.toContain(source)
    expect(requests.join('\n')).not.toContain(skillPackageRoot(root, manifest))
    expect(await Bun.file(marker).text()).toBe('unchanged')
    expect(bay.files.get('sbx-1')?.get(guest + '/notes/data.bin')).toEqual(Buffer.from(binary))
    expect(
      bay.requests.some((request) => {
        return request.body.includes(guest + '/scripts/work.js')
      })
    ).toBe(true)
    const explicitOnly = { ...manifest, disableModelInvocation: true }
    const privateLibrary = new ResourceLibrary(resources.config, [], [explicitOnly])
    expect(
      createSkillTools(privateLibrary, root, input, new ArtifactStore(root, room.id)).tools
    ).toHaveLength(0)
    input.text = '/skill reports help with this report'
    expect(
      createSkillTools(privateLibrary, root, input, new ArtifactStore(root, room.id)).tools
    ).toHaveLength(1)
  } finally {
    await model?.stop(true)
    await bay.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('skill import rejects symlinks, and package reads reject traversal and altered snapshots', async () => {
  const root = await mkdtemp('/tmp/pi-skill-boundary-')
  try {
    const source = join(root, 'source')
    await mkdir(source)
    await Bun.write(
      join(source, 'SKILL.md'),
      '---\nname: safe-skill\ndescription: A safe skill.\n---\nInstructions'
    )
    const config = SkillConfigSchema.parse({ id: 'safe', name: 'Safe', sourceDir: source })
    const manifest = await importSkill(config, root, root)
    await expect(readSkillFile(root, manifest, '../../providers.json')).rejects.toThrow('相对路径')
    await Bun.write(join(skillPackageRoot(root, manifest), 'SKILL.md'), 'tampered')
    await expect(readSkillFile(root, manifest, 'SKILL.md')).rejects.toThrow('已被修改')
    await Bun.write(join(root, 'outside.txt'), 'not a package resource')
    await symlink(join(root, 'outside.txt'), join(source, 'escape.txt'))
    await expect(importSkill(config, root, root)).rejects.toThrow('符号链接')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
