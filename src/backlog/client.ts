/**
 * Backlog APIクライアント。
 *
 * - レート制限を起動時に `GET /api/v2/rateLimit` で動的取得（ハードコードしない）
 * - 各レスポンスの `X-RateLimit-Remaining` を監視し、枯渇前に `X-RateLimit-Reset` まで待機
 * - 429を受けた場合も `X-RateLimit-Reset`（Unix秒）まで待機してリトライ
 * - ページネーション3方式: offset方式 / minId方式 / 一覧全件
 */

export interface RateLimitState {
  limit: number
  remaining: number
  /** Unix time (seconds) */
  reset: number
}

export interface RateLimitInfo {
  read: RateLimitState
  update: RateLimitState
  search: RateLimitState
  icon: RateLimitState
}

export interface WaitEvent {
  /** 待機理由: 'preemptive' = 残数枯渇の事前待機, '429' = レート制限超過応答 */
  reason: 'preemptive' | '429'
  /** 待機ミリ秒 */
  waitMs: number
  /** 再開予定の Unix time (ms) */
  resumeAt: number
}

export interface BacklogClientOptions {
  /** 例: https://example.backlog.jp */
  baseUrl: string
  apiKey: string
  /** テスト用に差し替え可能 */
  fetchFn?: typeof fetch
  /** テスト用: 現在時刻 (ms) */
  now?: () => number
  /** テスト用: スリープ */
  sleep?: (ms: number) => Promise<void>
  /** 残数がこの値以下になったら事前待機する（デフォルト 1） */
  minRemaining?: number
  /** レート制限待機の通知コールバック */
  onWait?: (event: WaitEvent) => void
  /** 429時の最大リトライ回数 */
  maxRetries?: number
}

/** URL中のAPIキーを伏せる（エラーメッセージ・ログ経由の漏洩防止） */
export function redactApiKey(url: string): string {
  return url.replace(/([?&]apiKey=)[^&]*/g, '$1***')
}

export class BacklogApiError extends Error {
  /** APIキーを伏せたURL */
  public readonly url: string

  constructor(
    public readonly status: number,
    url: string,
    public readonly body: string,
  ) {
    const redacted = redactApiKey(url)
    super(`Backlog API error ${status} for ${redacted}: ${body.slice(0, 200)}`)
    this.name = 'BacklogApiError'
    this.url = redacted
  }
}

type Params = Record<string, string | number | boolean | undefined>

export class BacklogClient {
  private readonly baseUrl: string
  private readonly apiKey: string
  private readonly fetchFn: typeof fetch
  private readonly now: () => number
  private readonly sleep: (ms: number) => Promise<void>
  private readonly minRemaining: number
  private readonly onWait?: (event: WaitEvent) => void
  private readonly maxRetries: number

  /** 直近のレスポンスヘッダから得たレート制限状態（read系のみ追跡） */
  private rateLimit: RateLimitState | null = null

  constructor(options: BacklogClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.apiKey = options.apiKey
    this.fetchFn = options.fetchFn ?? fetch
    this.now = options.now ?? (() => Date.now())
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
    this.minRemaining = options.minRemaining ?? 1
    this.onWait = options.onWait
    this.maxRetries = options.maxRetries ?? 5
  }

  private buildUrl(path: string, params?: Params): string {
    const url = new URL(this.baseUrl + path)
    url.searchParams.set('apiKey', this.apiKey)
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) url.searchParams.set(key, String(value))
      }
    }
    return url.toString()
  }

  /** レート制限情報の動的取得 */
  async getRateLimit(): Promise<RateLimitInfo> {
    const data = await this.requestJson<{ rateLimit: RateLimitInfo }>('/api/v2/rateLimit')
    return data.rateLimit
  }

  private updateRateLimitFromHeaders(headers: Headers): void {
    const limit = headers.get('X-RateLimit-Limit')
    const remaining = headers.get('X-RateLimit-Remaining')
    const reset = headers.get('X-RateLimit-Reset')
    if (limit !== null && remaining !== null && reset !== null) {
      this.rateLimit = {
        limit: Number(limit),
        remaining: Number(remaining),
        reset: Number(reset),
      }
    }
  }

  private async waitUntilReset(reset: number, reason: WaitEvent['reason']): Promise<void> {
    const resumeAt = reset * 1000
    // ヘッダの時計ずれに備え少しマージンを足す
    const waitMs = Math.max(0, resumeAt - this.now()) + 1000
    this.onWait?.({ reason, waitMs, resumeAt: this.now() + waitMs })
    await this.sleep(waitMs)
  }

  private async maybeWaitBeforeRequest(): Promise<void> {
    if (this.rateLimit && this.rateLimit.remaining <= this.minRemaining) {
      await this.waitUntilReset(this.rateLimit.reset, 'preemptive')
      // 待機後は残数不明になるためリセット
      this.rateLimit = null
    }
  }

  /** レート制限を考慮した生リクエスト */
  private async requestRaw(path: string, params?: Params): Promise<Response> {
    const url = this.buildUrl(path, params)
    for (let attempt = 0; ; attempt++) {
      await this.maybeWaitBeforeRequest()
      const res = await this.fetchFn(url)
      this.updateRateLimitFromHeaders(res.headers)
      if (res.status === 429) {
        if (attempt >= this.maxRetries) {
          const body = await res.text().catch(() => '')
          throw new BacklogApiError(res.status, url, body)
        }
        const reset = res.headers.get('X-RateLimit-Reset')
        if (reset !== null) {
          await this.waitUntilReset(Number(reset), '429')
        } else {
          // Resetヘッダがない場合は60秒待機（毎分リセットのため）
          const waitMs = 60_000
          this.onWait?.({ reason: '429', waitMs, resumeAt: this.now() + waitMs })
          await this.sleep(waitMs)
        }
        this.rateLimit = null
        continue
      }
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        throw new BacklogApiError(res.status, url, body)
      }
      return res
    }
  }

  async requestJson<T>(path: string, params?: Params): Promise<T> {
    const res = await this.requestRaw(path, params)
    return (await res.json()) as T
  }

  /**
   * ページネーション方式1: offset方式。
   * 課題一覧など。count件ずつ取得し、返却件数がcount未満になったら終了。
   */
  async *paginateOffset<T>(
    path: string,
    params?: Params,
    count = 100,
  ): AsyncGenerator<T, void, undefined> {
    let offset = 0
    for (;;) {
      const page = await this.requestJson<T[]>(path, { ...params, offset, count })
      yield* page
      if (page.length < count) return
      offset += count
    }
  }

  /**
   * ページネーション方式2: minId方式（IDページング）。
   * コメント一覧など。minIdより大きいIDをID昇順で取得し、最後のIDを次のminIdにする。
   * itemsのIDは `id` プロパティで取得する。
   */
  async *paginateMinId<T extends { id: number }>(
    path: string,
    params?: Params,
    count = 100,
  ): AsyncGenerator<T, void, undefined> {
    let minId = 0
    for (;;) {
      const page = await this.requestJson<T[]>(path, {
        ...params,
        minId,
        count,
        order: 'asc',
      })
      yield* page
      if (page.length < count) return
      const last = page[page.length - 1]
      if (last === undefined) return
      minId = last.id
    }
  }

  /**
   * ページネーション方式3: 一覧全件。
   * プロジェクト一覧・種別・カテゴリなど、1リクエストで全件返るエンドポイント。
   */
  async fetchAll<T>(path: string, params?: Params): Promise<T[]> {
    return await this.requestJson<T[]>(path, params)
  }

  /** ファイルダウンロード（添付など）。バイナリをそのまま返す。 */
  async download(path: string): Promise<{ body: Uint8Array; contentType: string | null }> {
    const res = await this.requestRaw(path)
    const buf = new Uint8Array(await res.arrayBuffer())
    return { body: buf, contentType: res.headers.get('Content-Type') }
  }
}
