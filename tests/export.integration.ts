/**
 * 実Backlogスペースに接続する結合テスト。
 * BACKLOG_DOMAIN / BACKLOG_API_KEY（環境変数または .env）が未設定の場合はスキップされる。
 * テスト用スペースのキーを使うこと。実行: pnpm test:integration
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { BacklogClient } from '../src/backlog/client.js'
import { Exporter, type ExporterEvent } from '../src/export/exporter.js'
import type { BacklogProject, BacklogSpace } from '../src/backlog/types.js'
import { loadTestEnv } from './helpers/env.js'

const env = loadTestEnv()

if (env === null) {
  console.log(
    'BACKLOG_DOMAIN / BACKLOG_API_KEY が未設定のため結合テストをスキップします（.env.example 参照）',
  )
}

describe.runIf(env !== null)('実Backlogスペースとの結合テスト', () => {
  const { domain, apiKey } = env ?? { domain: '', apiKey: '' }
  const client = new BacklogClient({ baseUrl: `https://${domain}`, apiKey })
  let outputDir: string

  afterAll(async () => {
    if (outputDir) await rm(outputDir, { recursive: true, force: true })
  })

  it('スペース情報とレート制限を取得できる', async () => {
    const space = await client.requestJson<BacklogSpace>('/api/v2/space')
    expect(space.name).toBeTruthy()
    const rateLimit = await client.getRateLimit()
    expect(rateLimit.read.limit).toBeGreaterThan(0)
    console.log(
      `スペース: ${space.name} / read rateLimit: ${rateLimit.read.limit}/min`,
    )
  })

  it('全プロジェクトをエクスポートし、出力形式v1の構成になっている', async () => {
    const projects = await client.fetchAll<BacklogProject>('/api/v2/projects', { all: true })
    expect(projects.length).toBeGreaterThan(0)
    const projectKeys = projects.map((p) => p.projectKey)
    console.log(`プロジェクト: ${projectKeys.join(', ')}`)

    outputDir = await mkdtemp(join(tmpdir(), 'bckle-integration-'))
    const events: ExporterEvent[] = []
    const exporter = new Exporter({
      client,
      spaceDomain: domain,
      outputDir,
      projectKeys,
      includeAttachments: true,
    })
    exporter.onEvent((e) => {
      events.push(e)
      if (e.type === 'phase') console.log(`  ${e.message}`)
      if (e.type === 'rateLimitWait') {
        console.log(`  レート制限待機: ${Math.round(e.waitMs / 1000)}秒`)
      }
    })
    await exporter.run()

    expect(events.at(-1)?.type).toBe('done')

    const manifest = JSON.parse(await readFile(join(outputDir, 'manifest.json'), 'utf8'))
    expect(manifest.formatVersion).toBe('1')
    expect(manifest.tool.name).toBe('bckle')
    expect(manifest.projects).toEqual(projectKeys)

    const users = JSON.parse(await readFile(join(outputDir, 'users.json'), 'utf8'))
    expect(Array.isArray(users)).toBe(true)
    expect(users.length).toBeGreaterThan(0)

    for (const key of projectKeys) {
      const dir = join(outputDir, 'projects', key)
      const project = JSON.parse(await readFile(join(dir, 'project.json'), 'utf8'))
      expect(project.project.projectKey).toBe(key)
      expect(Array.isArray(project.issueTypes)).toBe(true)
      expect(Array.isArray(project.statuses)).toBe(true)

      for (const file of ['issues.jsonl', 'comments.jsonl', 'wikis.jsonl']) {
        const text = await readFile(join(dir, file), 'utf8')
        const lines = text.split('\n').filter((l) => l.trim() !== '')
        // 各行が正しいJSONであること
        for (const line of lines) JSON.parse(line)
        console.log(`  ${key}/${file}: ${lines.length}件`)
      }
    }

    // 完了時には進捗ファイルが消えている
    await expect(readFile(join(outputDir, 'progress.json'))).rejects.toThrow()
  })
})
