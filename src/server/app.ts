import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, extname, normalize } from 'node:path'
import { BacklogClient } from '../backlog/client.js'
import type { BacklogProject, BacklogSpace } from '../backlog/types.js'
import { Exporter } from '../export/exporter.js'
import { loadProgress } from '../export/progress.js'
import { AppState, ExportJob } from './state.js'

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
}

export interface CreateAppOptions {
  /** ビルド済みGUI（vite build の出力）のディレクトリ */
  guiDir: string
}

export function createApp(options: CreateAppOptions): { app: Hono; state: AppState } {
  const state = new AppState()
  const app = new Hono()

  // --- API ---

  // 接続テスト。APIキーはメモリ内のstateにのみ保持する。
  app.post('/api/connect', async (c) => {
    const body = await c.req.json<{ spaceDomain?: string; apiKey?: string }>()
    const spaceDomain = body.spaceDomain?.trim()
    const apiKey = body.apiKey?.trim()
    if (!spaceDomain || !apiKey) {
      return c.json({ ok: false, error: 'スペースドメインとAPIキーを入力してください' }, 400)
    }
    if (!/^[a-z0-9-]+\.backlog\.(jp|com)$/i.test(spaceDomain)) {
      return c.json(
        { ok: false, error: 'ドメインは example.backlog.jp / example.backlog.com 形式で入力してください' },
        400,
      )
    }
    const client = new BacklogClient({ baseUrl: `https://${spaceDomain}`, apiKey })
    try {
      const space = await client.requestJson<BacklogSpace>('/api/v2/space')
      // レート制限の動的取得（接続時に一度取得して疎通確認を兼ねる）
      const rateLimit = await client.getRateLimit().catch(() => null)
      state.connection = { spaceDomain, apiKey, spaceName: space.name }
      state.client = client
      return c.json({ ok: true, spaceName: space.name, rateLimit })
    } catch (e) {
      return c.json(
        { ok: false, error: `接続に失敗しました: ${e instanceof Error ? e.message : String(e)}` },
        502,
      )
    }
  })

  app.get('/api/projects', async (c) => {
    if (!state.client) return c.json({ ok: false, error: '未接続です' }, 400)
    try {
      const projects = await state.client.fetchAll<BacklogProject>('/api/v2/projects', {
        all: true,
      })
      return c.json({
        ok: true,
        projects: projects.map((p) => ({
          id: p.id,
          projectKey: p.projectKey,
          name: p.name,
          archived: p.archived ?? false,
        })),
      })
    } catch (e) {
      return c.json(
        { ok: false, error: e instanceof Error ? e.message : String(e) },
        502,
      )
    }
  })

  // エクスポート開始（レジューム兼用: 同じ出力先に進捗ファイルがあれば続きから）
  app.post('/api/export/start', async (c) => {
    if (!state.client || !state.connection) {
      return c.json({ ok: false, error: '未接続です' }, 400)
    }
    if (state.job && state.job.status === 'running') {
      return c.json({ ok: false, error: 'エクスポートが既に実行中です' }, 409)
    }
    const body = await c.req.json<{
      projectKeys?: string[]
      outputDir?: string
      includeAttachments?: boolean
    }>()
    const projectKeys = body.projectKeys ?? []
    const outputDir = body.outputDir?.trim()
    if (projectKeys.length === 0 || !outputDir) {
      return c.json({ ok: false, error: 'プロジェクトと出力先を指定してください' }, 400)
    }
    const exporter = new Exporter({
      client: new BacklogClient({
        baseUrl: `https://${state.connection.spaceDomain}`,
        apiKey: state.connection.apiKey,
        onWait: (event) => job.exporter.handleWait(event),
      }),
      spaceDomain: state.connection.spaceDomain,
      outputDir,
      projectKeys,
      includeAttachments: body.includeAttachments ?? true,
    })
    const job = new ExportJob(exporter, outputDir)
    state.job = job
    // バックグラウンドで実行
    void exporter.run().catch(() => {
      // エラーはイベントとして通知済み
    })
    return c.json({ ok: true })
  })

  app.post('/api/export/abort', (c) => {
    if (!state.job) return c.json({ ok: false, error: 'エクスポートが実行されていません' }, 400)
    state.job.exporter.abort()
    return c.json({ ok: true })
  })

  // 出力先のレジューム可否確認
  app.get('/api/export/resumable', async (c) => {
    const outputDir = c.req.query('outputDir')
    if (!outputDir) return c.json({ ok: false, error: 'outputDirが必要です' }, 400)
    const progress = await loadProgress(outputDir)
    return c.json({ ok: true, resumable: progress !== null, progress })
  })

  // SSEによる進捗配信
  app.get('/api/export/events', (c) => {
    const job = state.job
    if (!job) return c.json({ ok: false, error: 'エクスポートが実行されていません' }, 400)
    return streamSSE(c, async (stream) => {
      let lastId = Number(c.req.query('lastEventId') ?? 0)
      for (;;) {
        const entries = await job.waitForEvents(lastId)
        for (const entry of entries) {
          await stream.writeSSE({
            id: String(entry.id),
            event: entry.event.type,
            data: JSON.stringify(entry.event),
          })
          lastId = entry.id
        }
        if (job.status !== 'running' && entries.length === 0) {
          await stream.writeSSE({ event: 'end', data: JSON.stringify({ status: job.status }) })
          return
        }
        if (entries.length === 0) {
          // keep-alive
          await stream.writeSSE({ event: 'ping', data: '{}' })
        }
      }
    })
  })

  app.get('/api/status', (c) => {
    return c.json({
      connected: state.connection !== null,
      spaceName: state.connection?.spaceName ?? null,
      spaceDomain: state.connection?.spaceDomain ?? null,
      job: state.job
        ? { status: state.job.status, outputDir: state.job.outputDir }
        : null,
    })
  })

  // --- 静的ファイル配信（ビルド済みGUI） ---
  app.get('*', async (c) => {
    const reqPath = normalize(c.req.path).replace(/^\/+/, '')
    if (reqPath.includes('..')) return c.notFound()
    const filePath = join(options.guiDir, reqPath === '' ? 'index.html' : reqPath)
    const resolved = existsSync(filePath) ? filePath : join(options.guiDir, 'index.html')
    try {
      const content = await readFile(resolved)
      const mime = MIME_TYPES[extname(resolved)] ?? 'application/octet-stream'
      return c.body(new Uint8Array(content), 200, { 'Content-Type': mime })
    } catch {
      return c.notFound()
    }
  })

  return { app, state }
}
