import { describe, expect, it } from 'vitest'
import { BacklogClient, type WaitEvent } from '../src/backlog/client.js'

interface MockResponseSpec {
  status?: number
  body?: unknown
  headers?: Record<string, string>
}

function createMockFetch(specs: MockResponseSpec[]) {
  const calls: string[] = []
  let index = 0
  const fetchFn = (async (input: string | URL | Request) => {
    const url = String(input)
    calls.push(url)
    const spec = specs[Math.min(index, specs.length - 1)]
    index++
    if (spec === undefined) throw new Error('no mock response')
    return new Response(JSON.stringify(spec.body ?? {}), {
      status: spec.status ?? 200,
      headers: { 'Content-Type': 'application/json', ...spec.headers },
    })
  }) as typeof fetch
  return { fetchFn, calls }
}

function createClient(
  specs: MockResponseSpec[],
  options?: { minRemaining?: number; nowSec?: number },
) {
  const { fetchFn, calls } = createMockFetch(specs)
  const sleeps: number[] = []
  const waits: WaitEvent[] = []
  const nowMs = (options?.nowSec ?? 1000) * 1000
  const client = new BacklogClient({
    baseUrl: 'https://example.backlog.jp',
    apiKey: 'test-key',
    fetchFn,
    now: () => nowMs,
    sleep: async (ms) => {
      sleeps.push(ms)
    },
    minRemaining: options?.minRemaining,
    onWait: (e) => waits.push(e),
  })
  return { client, calls, sleeps, waits }
}

function page(items: unknown[], headers?: Record<string, string>): MockResponseSpec {
  return { body: items, headers }
}

describe('paginateOffset', () => {
  it('countずつoffsetを進め、count未満のページで終了する', async () => {
    const { client, calls } = createClient([
      page([{ id: 1 }, { id: 2 }, { id: 3 }]),
      page([{ id: 4 }, { id: 5 }, { id: 6 }]),
      page([{ id: 7 }]),
    ])
    const items: Array<{ id: number }> = []
    for await (const item of client.paginateOffset<{ id: number }>('/api/v2/issues', {}, 3)) {
      items.push(item)
    }
    expect(items.map((i) => i.id)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(calls).toHaveLength(3)
    expect(new URL(calls[0]!).searchParams.get('offset')).toBe('0')
    expect(new URL(calls[1]!).searchParams.get('offset')).toBe('3')
    expect(new URL(calls[2]!).searchParams.get('offset')).toBe('6')
    expect(new URL(calls[0]!).searchParams.get('count')).toBe('3')
  })

  it('ちょうどcountの倍数の場合、空ページで終了する', async () => {
    const { client, calls } = createClient([page([{ id: 1 }, { id: 2 }]), page([])])
    const items: unknown[] = []
    for await (const item of client.paginateOffset('/api/v2/issues', {}, 2)) {
      items.push(item)
    }
    expect(items).toHaveLength(2)
    expect(calls).toHaveLength(2)
  })
})

describe('paginateMinId', () => {
  it('最後のIDをminIdとして次ページを取得し、count未満で終了する', async () => {
    const { client, calls } = createClient([
      page([{ id: 10 }, { id: 20 }]),
      page([{ id: 30 }, { id: 40 }]),
      page([{ id: 50 }]),
    ])
    const items: Array<{ id: number }> = []
    for await (const item of client.paginateMinId<{ id: number }>(
      '/api/v2/issues/PROJ-1/comments',
      {},
      2,
    )) {
      items.push(item)
    }
    expect(items.map((i) => i.id)).toEqual([10, 20, 30, 40, 50])
    expect(calls).toHaveLength(3)
    expect(new URL(calls[0]!).searchParams.get('minId')).toBe('0')
    expect(new URL(calls[1]!).searchParams.get('minId')).toBe('20')
    expect(new URL(calls[2]!).searchParams.get('minId')).toBe('40')
    expect(new URL(calls[0]!).searchParams.get('order')).toBe('asc')
  })
})

describe('fetchAll', () => {
  it('1リクエストで全件を返す', async () => {
    const { client, calls } = createClient([page([{ id: 1 }, { id: 2 }])])
    const items = await client.fetchAll('/api/v2/projects', { all: true })
    expect(items).toHaveLength(2)
    expect(calls).toHaveLength(1)
    expect(new URL(calls[0]!).searchParams.get('all')).toBe('true')
    expect(new URL(calls[0]!).searchParams.get('apiKey')).toBe('test-key')
  })
})

describe('レート制限', () => {
  it('429を受けたらX-RateLimit-Resetまで待機してリトライする', async () => {
    // now = 1000秒, reset = 1030秒 → 30秒 + マージン1秒待機
    const { client, calls, sleeps, waits } = createClient([
      { status: 429, headers: { 'X-RateLimit-Reset': '1030' } },
      page([{ id: 1 }]),
    ])
    const result = await client.requestJson<Array<{ id: number }>>('/api/v2/issues')
    expect(result).toEqual([{ id: 1 }])
    expect(calls).toHaveLength(2)
    expect(sleeps).toEqual([31_000])
    expect(waits).toHaveLength(1)
    expect(waits[0]!.reason).toBe('429')
  })

  it('X-RateLimit-Remainingが閾値以下になったら次のリクエスト前に事前待機する', async () => {
    const { client, sleeps, waits } = createClient([
      // 1回目: remaining=0（枯渇）
      page([{ id: 1 }], {
        'X-RateLimit-Limit': '600',
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': '1010',
      }),
      // 2回目: 待機後に成功
      page([{ id: 2 }]),
    ])
    await client.requestJson('/api/v2/issues')
    expect(sleeps).toHaveLength(0) // 1回目の後はまだ待たない
    await client.requestJson('/api/v2/issues')
    expect(sleeps).toEqual([11_000]) // (1010-1000)*1000 + 1000ms マージン
    expect(waits[0]!.reason).toBe('preemptive')
  })

  it('remainingに余裕があれば待機しない', async () => {
    const { client, sleeps } = createClient([
      page([{ id: 1 }], {
        'X-RateLimit-Limit': '600',
        'X-RateLimit-Remaining': '599',
        'X-RateLimit-Reset': '1060',
      }),
      page([{ id: 2 }]),
    ])
    await client.requestJson('/api/v2/issues')
    await client.requestJson('/api/v2/issues')
    expect(sleeps).toHaveLength(0)
  })

  it('429が続いてもmaxRetriesを超えたらエラーを投げる', async () => {
    const { fetchFn } = createMockFetch([
      { status: 429, headers: { 'X-RateLimit-Reset': '1001' } },
    ])
    const client = new BacklogClient({
      baseUrl: 'https://example.backlog.jp',
      apiKey: 'k',
      fetchFn,
      now: () => 1000_000,
      sleep: async () => {},
      maxRetries: 2,
    })
    await expect(client.requestJson('/api/v2/issues')).rejects.toThrow(/429/)
  })

  it('getRateLimitでレート制限情報を取得できる', async () => {
    const { client } = createClient([
      {
        body: {
          rateLimit: {
            read: { limit: 600, remaining: 600, reset: 1060 },
            update: { limit: 150, remaining: 150, reset: 1060 },
            search: { limit: 150, remaining: 150, reset: 1060 },
            icon: { limit: 60, remaining: 60, reset: 1060 },
          },
        },
      },
    ])
    const info = await client.getRateLimit()
    expect(info.read.limit).toBe(600)
    expect(info.icon.remaining).toBe(60)
  })
})

describe('エラー処理', () => {
  it('4xx/5xx（429以外）はリトライせずエラーを投げる', async () => {
    const { client, calls } = createClient([
      { status: 401, body: { errors: [{ message: 'auth error' }] } },
    ])
    await expect(client.requestJson('/api/v2/space')).rejects.toThrow(/401/)
    expect(calls).toHaveLength(1)
  })
})
