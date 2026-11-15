import { describe, expect, test } from 'bun:test'
import { parseWebOrigins, webOriginAllowed } from '@pi-im-bot/bot/web-origin'
import { botApiUrl, botWebSocketUrl } from '@pi-im-bot/web/bot-origin'

describe('independent web origins', () => {
  test('normalizes HTTP origins and rejects credentials and non-HTTP schemes', () => {
    expect(parseWebOrigins('http://localhost:3000/, https://ui.example')).toEqual([
      'http://localhost:3000',
      'https://ui.example'
    ])
    expect(() => parseWebOrigins('https://secret@ui.example')).toThrow('without credentials')
    expect(() => parseWebOrigins('file:///tmp/ui')).toThrow('HTTP(S)')
  })

  test('requires a matching browser origin while allowing non-browser requests', () => {
    const allowed = parseWebOrigins('https://ui.example')
    expect(webOriginAllowed(null, allowed)).toBe(true)
    expect(webOriginAllowed('https://ui.example', allowed)).toBe(true)
    expect(webOriginAllowed('https://other.example', allowed)).toBe(false)
  })

  test('builds all browser API and WebSocket addresses from the bot origin', () => {
    expect(botApiUrl('/api/state', 'https://bot.example')).toBe('https://bot.example/api/state')
    expect(botWebSocketUrl('/api/events', 'https://bot.example')).toBe('wss://bot.example/api/events')
    expect(botWebSocketUrl('/onebot/v11/ws', 'http://bot.example:19335')).toBe(
      'ws://bot.example:19335/onebot/v11/ws'
    )
    expect(() => botApiUrl('api/state')).toThrow('absolute')
  })
})
