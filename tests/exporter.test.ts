import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BacklogClient } from '../src/backlog/client.js'
import { Exporter, type ExporterEvent } from '../src/export/exporter.js'

function createRoutedFetch(routes: Record<string, unknown | ((url: URL) => unknown)>) {
  const fetchFn = (async (input: string | URL | Request) => {
    const url = new URL(String(input))
    const key = url.pathname
    if (!(key in routes)) {
      return new Response(JSON.stringify({ errors: [{ message: `no route: ${key}` }] }), {
        status: 404,
      })
    }
    const route = routes[key]
    if (route instanceof Response) return route.clone()
    const data = typeof route === 'function' ? route(url) : route
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as typeof fetch
  return fetchFn
}

describe('Exporter', () => {
  let outputDir: string

  beforeEach(async () => {
    outputDir = await mkdtemp(join(tmpdir(), 'backle-test-'))
  })

  afterEach(async () => {
    await rm(outputDir, { recursive: true, force: true })
  })

  it('形式v1の一式を出力し、完了時に進捗ファイルを削除する', async () => {
    const issue = { id: 101, issueKey: 'PROJ-1', summary: 'test issue', attachments: [] }
    const fetchFn = createRoutedFetch({
      '/api/v2/space': { spaceKey: 'example', name: 'Example Space' },
      '/api/v2/users': [{ id: 1, name: 'user1' }],
      '/api/v2/projects/PROJ': { id: 10, projectKey: 'PROJ', name: 'Project' },
      '/api/v2/projects/PROJ/issueTypes': [],
      '/api/v2/projects/PROJ/categories': [],
      '/api/v2/projects/PROJ/versions': [],
      '/api/v2/projects/PROJ/customFields': [],
      '/api/v2/projects/PROJ/statuses': [],
      '/api/v2/issues/count': { count: 1 },
      '/api/v2/issues': [issue],
      '/api/v2/issues/PROJ-1/comments': [{ id: 501, content: 'a comment' }],
      '/api/v2/wikis': [{ id: 900, name: 'Home' }],
      '/api/v2/wikis/900': { id: 900, name: 'Home', content: 'wiki body', attachments: [] },
      // 履歴APIは最大10件/ページ（実地検証済みの挙動を再現）: 全25版をminIdでページング
      '/api/v2/wikis/900/history': (url: URL) => {
        const minId = Number(url.searchParams.get('minId') ?? 0)
        const versions = Array.from({ length: 25 }, (_, i) => i + 1).filter((v) => v > minId)
        return versions.slice(0, 10).map((version) => ({ version, content: `v${version}` }))
      },
    })
    const client = new BacklogClient({
      baseUrl: 'https://example.backlog.jp',
      apiKey: 'k',
      fetchFn,
    })
    const exporter = new Exporter({
      client,
      spaceDomain: 'example.backlog.jp',
      outputDir,
      projectKeys: ['PROJ'],
      includeAttachments: false,
    })
    const events: ExporterEvent[] = []
    exporter.onEvent((e) => events.push(e))
    await exporter.run()

    const manifest = JSON.parse(await readFile(join(outputDir, 'manifest.json'), 'utf8'))
    expect(manifest.formatVersion).toBe('1')
    expect(manifest.space.domain).toBe('example.backlog.jp')
    expect(manifest.projects).toEqual(['PROJ'])

    const users = JSON.parse(await readFile(join(outputDir, 'users.json'), 'utf8'))
    expect(users).toHaveLength(1)

    const projectDir = join(outputDir, 'projects', 'PROJ')
    const projectJson = JSON.parse(await readFile(join(projectDir, 'project.json'), 'utf8'))
    expect(projectJson.project.projectKey).toBe('PROJ')

    const issuesLines = (await readFile(join(projectDir, 'issues.jsonl'), 'utf8'))
      .trim()
      .split('\n')
    expect(issuesLines).toHaveLength(1)
    expect(JSON.parse(issuesLines[0]!).issueKey).toBe('PROJ-1')

    const commentLines = (await readFile(join(projectDir, 'comments.jsonl'), 'utf8'))
      .trim()
      .split('\n')
    expect(commentLines).toHaveLength(1)
    const comment = JSON.parse(commentLines[0]!)
    expect(comment.issueKey).toBe('PROJ-1')
    expect(comment.id).toBe(501)

    const wikiLines = (await readFile(join(projectDir, 'wikis.jsonl'), 'utf8'))
      .trim()
      .split('\n')
    expect(wikiLines).toHaveLength(1)
    // 履歴が10件/ページの制約を越えて全25版取得できている
    const history = JSON.parse(wikiLines[0]!).history
    expect(history).toHaveLength(25)
    expect(history.map((h: { version: number }) => h.version)).toEqual(
      Array.from({ length: 25 }, (_, i) => i + 1),
    )

    // 完了時には進捗ファイルが削除されている
    await expect(stat(join(outputDir, 'progress.json'))).rejects.toThrow()

    expect(events.at(-1)).toEqual({ type: 'done', outputDir })
    expect(events.some((e) => e.type === 'projectDone')).toBe(true)
  })

  it('Wikiが利用できないスペース（403）ではWikiをスキップして完走する', async () => {
    const issue = { id: 101, issueKey: 'PROJ-1', summary: 'test issue', attachments: [] }
    const fetchFn = createRoutedFetch({
      '/api/v2/space': { spaceKey: 'example', name: 'Example Space' },
      '/api/v2/users': [{ id: 1, name: 'user1' }],
      '/api/v2/projects/PROJ': { id: 10, projectKey: 'PROJ', name: 'Project' },
      '/api/v2/projects/PROJ/issueTypes': [],
      '/api/v2/projects/PROJ/categories': [],
      '/api/v2/projects/PROJ/versions': [],
      '/api/v2/projects/PROJ/customFields': [],
      '/api/v2/projects/PROJ/statuses': [],
      '/api/v2/issues/count': { count: 1 },
      '/api/v2/issues': [issue],
      '/api/v2/issues/PROJ-1/comments': [],
      '/api/v2/wikis': new Response(
        JSON.stringify({ errors: [{ message: 'msg.featureRestrictedError.title.wiki', code: 5 }] }),
        { status: 403 },
      ),
    })
    const client = new BacklogClient({
      baseUrl: 'https://example.backlog.jp',
      apiKey: 'k',
      fetchFn,
    })
    const exporter = new Exporter({
      client,
      spaceDomain: 'example.backlog.jp',
      outputDir,
      projectKeys: ['PROJ'],
      includeAttachments: false,
    })
    const events: ExporterEvent[] = []
    exporter.onEvent((e) => events.push(e))
    await exporter.run()

    expect(events.at(-1)).toEqual({ type: 'done', outputDir })
    const wikis = await readFile(join(outputDir, 'projects', 'PROJ', 'wikis.jsonl'), 'utf8')
    expect(wikis).toBe('')
  })
})
