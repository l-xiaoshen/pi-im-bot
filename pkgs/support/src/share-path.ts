export function assertSharePath(path: string) {
  const parts = path.replaceAll('\\', '/').toLowerCase().split('/')
  if (
    parts.some((part) => {
      return part === '.codex' || part === 'agents.md' || part === 'agents.override.md'
    })
  ) {
    throw new Error('分享内容不得包含开发代理配置：' + path)
  }
}
