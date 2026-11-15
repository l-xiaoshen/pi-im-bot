import { createHash, timingSafeEqual } from 'node:crypto'
import { QQIdSchema, type OneBotConfig } from './config'

export function tokenRevision(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

export function authorizeOneBot(request: Request, config: OneBotConfig) {
  if (!config.enabled) {
    return { ok: false as const, status: 403, reason: '接入已停用' }
  }
  const self = QQIdSchema.safeParse(request.headers.get('x-self-id'))
  if (!self.success) {
    return { ok: false as const, status: 400, reason: '缺少有效 X-Self-ID' }
  }
  if (config.accessToken) {
    const header = request.headers.get('authorization')
    let token = new URL(request.url).searchParams.get('access_token') ?? ''
    if (header !== null) {
      token = header.match(/^Bearer\s+(.+)$/iu)?.[1] ?? ''
    }
    if (
      token.length > 4096 ||
      !timingSafeEqual(
        Buffer.from(tokenRevision(token), 'hex'),
        Buffer.from(tokenRevision(config.accessToken), 'hex')
      )
    ) {
      return { ok: false as const, status: 401, reason: 'Access Token 不匹配' }
    }
  }
  return { ok: true as const, selfId: self.data, revision: tokenRevision(config.accessToken) }
}
