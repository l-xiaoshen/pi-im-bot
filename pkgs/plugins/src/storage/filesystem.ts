import { access, readFile, mkdir } from 'node:fs/promises'
import { constants } from 'node:fs'
import type { PluginStorageConfig } from './config'
import { BACKGROUND_CONTEXT, awaitWithContext, withAbortSignal } from '@earendil-works/chord/context'

function decodeMount(value: string) {
  return value.replace(/\\([0-7]{3})/gu, (_raw, octal: string) => {
    return String.fromCharCode(Number.parseInt(octal, 8))
  })
}

export interface FilesystemMount {
  source: string
  type: string
  path: string
}
export async function filesystemMount(path: string): Promise<FilesystemMount | undefined> {
  for (const line of (await readFile('/proc/self/mountinfo', 'utf8')).split('\n')) {
    const [fields, filesystem] = line.split(' - ')
    if (!filesystem) {
      continue
    }
    const mountpoint = decodeMount(fields.split(' ')[4])
    if (mountpoint !== path) {
      continue
    }
    const [type, source] = filesystem.split(' ')
    return { source: decodeMount(source), type, path }
  }
  return undefined
}

export async function storageDependencies(config: PluginStorageConfig) {
  if (process.platform !== 'linux') {
    return false
  }
  try {
    for (const executable of [
      config.formatCommand,
      config.checkCommand,
      config.mountCommand,
      config.unmountCommand
    ]) {
      await access(executable, constants.X_OK)
    }
    await access('/dev/fuse', constants.R_OK | constants.W_OK)
    return true
  } catch {
    return false
  }
}

export async function runStorageCommand(
  command: string,
  args: string[],
  signal: AbortSignal,
  accepted = [0]
) {
  signal.throwIfAborted()
  const child = Bun.spawn([command, ...args], {
    stdin: 'ignore',
    stdout: 'ignore',
    stderr: 'ignore',
    env: { PATH: '/usr/bin:/bin' }
  })
  const abort = () => {
    child.kill('SIGKILL')
  }
  signal.addEventListener('abort', abort, { once: true })
  try {
    const code = await awaitWithContext(child.exited, withAbortSignal(signal, BACKGROUND_CONTEXT))
    if (!accepted.includes(code)) {
      throw new Error('插件文件系统工具失败，退出码 ' + code)
    }
  } catch (error) {
    if (signal.aborted) {
      child.kill('SIGKILL')
    }
    throw error
  } finally {
    signal.removeEventListener('abort', abort)
  }
}

interface FuseProcess {
  image: string
  child: ReturnType<typeof Bun.spawn>
}
export class FuseFilesystem {
  private readonly children = new Map<string, FuseProcess>()
  constructor(private readonly config: PluginStorageConfig) {}

  async mount(image: string, path: string, signal: AbortSignal) {
    const existing = await filesystemMount(path)
    if (existing) {
      this.assertOwned(existing, image)
      return
    }
    await mkdir(path, { recursive: true, mode: 0o700 })
    const child = Bun.spawn([this.config.mountCommand, image, path, '-f', '-o', 'nosuid,nodev,noexec'], {
      stdin: 'ignore',
      stdout: 'ignore',
      stderr: 'ignore',
      env: { PATH: '/usr/bin:/bin' }
    })
    this.children.set(path, { image, child })
    try {
      for (;;) {
        signal.throwIfAborted()
        const mounted = await filesystemMount(path)
        if (mounted) {
          this.assertOwned(mounted, image)
          return
        }
        if (child.exitCode !== null) {
          throw new Error('fuse2fs 未建立插件数据挂载，退出码 ' + child.exitCode)
        }
        await Bun.sleep(25)
      }
    } catch (error) {
      const mounted = await filesystemMount(path)
      if (mounted) {
        await this.unmount(image, path)
      } else {
        child.kill('SIGTERM')
        await child.exited
        this.children.delete(path)
      }
      throw error
    }
  }

  async unmount(image: string, path: string) {
    const mounted = await filesystemMount(path)
    if (mounted) {
      this.assertOwned(mounted, image)
      const signal = AbortSignal.timeout(this.config.timeoutMs)
      let failure: unknown
      for (let attempt = 0; attempt < 10; attempt++) {
        try {
          await runStorageCommand(this.config.unmountCommand, ['-u', path], signal)
          failure = undefined
          break
        } catch (error) {
          failure = error
          signal.throwIfAborted()
          await Bun.sleep(50)
        }
      }
      if (failure) {
        throw failure
      }
    }
    const entry = this.children.get(path)
    if (entry) {
      if (!mounted && entry.child.exitCode === null) {
        entry.child.kill('SIGTERM')
      }
      await entry.child.exited
      this.children.delete(path)
    }
  }
  async close() {
    for (const [path, entry] of this.children) {
      await this.unmount(entry.image, path)
    }
  }
  private assertOwned(mount: FilesystemMount, image: string) {
    if (mount.source !== image || !['fuse2fs', 'fuse.fuse2fs', 'fuse.ext4'].includes(mount.type)) {
      throw new Error('拒绝操作不属于本插件镜像的挂载')
    }
  }
}
