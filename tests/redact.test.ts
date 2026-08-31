import { describe, expect, it } from 'vitest'
import { BacklogApiError, redactApiKey } from '../src/backlog/client.js'

describe('APIキーの秘匿', () => {
  it('URL中のapiKeyを伏せる', () => {
    expect(redactApiKey('https://x.backlog.jp/api/v2/space?apiKey=SECRET123')).toBe(
      'https://x.backlog.jp/api/v2/space?apiKey=***',
    )
    expect(redactApiKey('https://x.backlog.jp/api/v2/wikis?apiKey=SECRET&projectIdOrKey=P')).toBe(
      'https://x.backlog.jp/api/v2/wikis?apiKey=***&projectIdOrKey=P',
    )
  })

  it('BacklogApiErrorのメッセージとurlにAPIキーが含まれない', () => {
    const err = new BacklogApiError(
      403,
      'https://x.backlog.jp/api/v2/wikis?apiKey=SECRET123&projectIdOrKey=P',
      '{"errors":[]}',
    )
    expect(err.message).not.toContain('SECRET123')
    expect(err.url).not.toContain('SECRET123')
    expect(err.message).toContain('apiKey=***')
  })
})
