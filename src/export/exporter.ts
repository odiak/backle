import { mkdir, writeFile, appendFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { BacklogApiError, BacklogClient, type WaitEvent } from '../backlog/client.js'
import type {
  BacklogAttachment,
  BacklogComment,
  BacklogIssue,
  BacklogProject,
  BacklogUser,
  BacklogWiki,
  BacklogWikiSummary,
} from '../backlog/types.js'
import {
  loadProgress,
  newProjectProgress,
  saveProgress,
  type ExportProgress,
  type ProjectProgress,
} from './progress.js'

export const FORMAT_VERSION = '1'
export const TOOL_NAME = 'bckle'
export const TOOL_VERSION = '0.1.0'

export interface ExporterOptions {
  client: BacklogClient
  spaceDomain: string
  outputDir: string
  projectKeys: string[]
  includeAttachments: boolean
}

export type ExporterEvent =
  | { type: 'phase'; projectKey: string | null; phase: string; message: string }
  | {
      type: 'progress'
      projectKey: string
      phase: string
      current: number
      total: number | null
    }
  | { type: 'rateLimitWait'; waitMs: number; resumeAt: number; reason: string }
  | { type: 'projectDone'; projectKey: string }
  | { type: 'done'; outputDir: string }
  | { type: 'error'; message: string }
  | { type: 'aborted' }

export type ExporterListener = (event: ExporterEvent) => void

class AbortedError extends Error {
  constructor() {
    super('export aborted')
    this.name = 'AbortedError'
  }
}

/**
 * ファイル名に使えない文字・名前を置換する。
 * Windowsの制約（禁止文字、CON/NUL等の予約名、末尾のドット・空白）にも対応する。
 */
export function sanitizeFilename(name: string): string {
  let result = name.replace(/[\/\\:*?"<>|\x00-\x1f]/g, '_')
  // Windowsでは末尾のドット・空白が無視され衝突や失敗の原因になる
  result = result.replace(/[. ]+$/, '')
  if (result === '') return '_'
  // Windows予約名（拡張子付きも不可: 例 con.txt）
  const stem = result.split('.')[0] ?? result
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(stem)) {
    result = `_${result}`
  }
  return result
}

export class Exporter {
  private readonly client: BacklogClient
  private readonly outputDir: string
  private readonly options: ExporterOptions
  private listeners: ExporterListener[] = []
  private aborted = false

  constructor(options: ExporterOptions) {
    this.client = options.client
    this.outputDir = options.outputDir
    this.options = options
  }

  onEvent(listener: ExporterListener): void {
    this.listeners.push(listener)
  }

  handleWait(event: WaitEvent): void {
    this.emit({
      type: 'rateLimitWait',
      waitMs: event.waitMs,
      resumeAt: event.resumeAt,
      reason: event.reason,
    })
  }

  abort(): void {
    this.aborted = true
  }

  private emit(event: ExporterEvent): void {
    for (const l of this.listeners) l(event)
  }

  private checkAborted(): void {
    if (this.aborted) throw new AbortedError()
  }

  async run(): Promise<void> {
    try {
      await this.runInner()
      this.emit({ type: 'done', outputDir: this.outputDir })
    } catch (e) {
      if (e instanceof AbortedError) {
        this.emit({ type: 'aborted' })
        return
      }
      this.emit({ type: 'error', message: e instanceof Error ? e.message : String(e) })
      throw e
    }
  }

  private async runInner(): Promise<void> {
    await mkdir(this.outputDir, { recursive: true })

    // レジューム: 既存の進捗ファイルがあれば引き継ぐ
    let progress = await loadProgress(this.outputDir)
    if (
      progress === null ||
      progress.spaceDomain !== this.options.spaceDomain ||
      JSON.stringify(progress.projectKeys) !== JSON.stringify(this.options.projectKeys)
    ) {
      progress = {
        formatVersion: FORMAT_VERSION,
        startedAt: new Date().toISOString(),
        spaceDomain: this.options.spaceDomain,
        includeAttachments: this.options.includeAttachments,
        usersDone: false,
        projects: {},
        projectKeys: this.options.projectKeys,
      }
    }
    const save = () => saveProgress(this.outputDir, progress)
    await save()

    // manifest.json
    this.emit({ type: 'phase', projectKey: null, phase: 'manifest', message: 'マニフェスト作成' })
    const space = await this.client.requestJson<Record<string, unknown>>('/api/v2/space')
    const manifest = {
      formatVersion: FORMAT_VERSION,
      tool: { name: TOOL_NAME, version: TOOL_VERSION },
      exportedAt: new Date().toISOString(),
      space: { domain: this.options.spaceDomain, ...space },
      options: { includeAttachments: this.options.includeAttachments },
      projects: this.options.projectKeys,
    }
    await writeFile(join(this.outputDir, 'manifest.json'), JSON.stringify(manifest, null, 2))

    // users.json
    if (!progress.usersDone) {
      this.checkAborted()
      this.emit({ type: 'phase', projectKey: null, phase: 'users', message: 'ユーザー一覧取得' })
      const users = await this.client.fetchAll<BacklogUser>('/api/v2/users')
      await writeFile(join(this.outputDir, 'users.json'), JSON.stringify(users, null, 2))
      progress.usersDone = true
      await save()
    }

    // プロジェクトごとのエクスポート
    for (const projectKey of this.options.projectKeys) {
      this.checkAborted()
      let pp = progress.projects[projectKey]
      if (pp === undefined) {
        pp = newProjectProgress()
        progress.projects[projectKey] = pp
      }
      if (pp.phase === 'done') continue
      await this.exportProject(projectKey, pp, save)
      this.emit({ type: 'projectDone', projectKey })
    }

    // 完了: 進捗ファイルを削除
    await rm(join(this.outputDir, 'progress.json'), { force: true })
  }

  private async exportProject(
    projectKey: string,
    pp: ProjectProgress,
    save: () => Promise<void>,
  ): Promise<void> {
    const dir = join(this.outputDir, 'projects', projectKey)
    await mkdir(dir, { recursive: true })

    // 1. project.json（設定・種別・状態・カテゴリ・バージョン・カスタム属性定義）
    if (pp.phase === 'pending' || pp.phase === 'project') {
      pp.phase = 'project'
      await save()
      this.emit({
        type: 'phase',
        projectKey,
        phase: 'project',
        message: `${projectKey}: プロジェクト設定取得`,
      })
      const base = `/api/v2/projects/${projectKey}`
      const [project, issueTypes, categories, versions, customFields, statuses] =
        await Promise.all([
          this.client.requestJson<BacklogProject>(base),
          this.client.fetchAll<unknown>(`${base}/issueTypes`),
          this.client.fetchAll<unknown>(`${base}/categories`),
          this.client.fetchAll<unknown>(`${base}/versions`),
          this.client.fetchAll<unknown>(`${base}/customFields`),
          this.client.fetchAll<unknown>(`${base}/statuses`),
        ])
      const projectJson = { project, issueTypes, categories, versions, customFields, statuses }
      await writeFile(join(dir, 'project.json'), JSON.stringify(projectJson, null, 2))
      pp.phase = 'issues'
      await save()
    }

    const projectId = await this.getProjectId(projectKey)

    // 2. issues.jsonl（offset方式ページネーション、途中から再開可能）
    if (pp.phase === 'issues') {
      const issuesPath = join(dir, 'issues.jsonl')
      if (pp.issueOffset === 0) await writeFile(issuesPath, '')
      const total = await this.getIssueCount(projectId)
      this.emit({
        type: 'phase',
        projectKey,
        phase: 'issues',
        message: `${projectKey}: 課題取得 (${total}件)`,
      })
      const count = 100
      for (;;) {
        this.checkAborted()
        const page = await this.client.requestJson<BacklogIssue[]>('/api/v2/issues', {
          'projectId[]': projectId,
          sort: 'created',
          order: 'asc',
          offset: pp.issueOffset,
          count,
        })
        if (page.length > 0) {
          await appendFile(issuesPath, page.map((i) => JSON.stringify(i)).join('\n') + '\n')
        }
        pp.issueOffset += page.length
        pp.issueCount += page.length
        await save()
        this.emit({
          type: 'progress',
          projectKey,
          phase: 'issues',
          current: pp.issueCount,
          total,
        })
        if (page.length < count) break
      }
      pp.phase = 'comments'
      pp.commentIssueIndex = 0
      await save()
    }

    // issues.jsonl から課題キー一覧を復元（レジューム時もここから再構築）
    const issues = await this.readIssuesJsonl(dir)

    // 3. comments.jsonl（課題ごとにminId方式ページネーション）
    if (pp.phase === 'comments') {
      const commentsPath = join(dir, 'comments.jsonl')
      if (pp.commentIssueIndex === 0) await writeFile(commentsPath, '')
      this.emit({
        type: 'phase',
        projectKey,
        phase: 'comments',
        message: `${projectKey}: コメント取得 (${issues.length}課題)`,
      })
      for (let i = pp.commentIssueIndex; i < issues.length; i++) {
        this.checkAborted()
        const issue = issues[i]
        if (issue === undefined) continue
        for await (const comment of this.client.paginateMinId<BacklogComment>(
          `/api/v2/issues/${issue.issueKey}/comments`,
        )) {
          await appendFile(
            commentsPath,
            JSON.stringify({ issueKey: issue.issueKey, issueId: issue.id, ...comment }) + '\n',
          )
          pp.commentCount++
        }
        pp.commentIssueIndex = i + 1
        await save()
        this.emit({
          type: 'progress',
          projectKey,
          phase: 'comments',
          current: i + 1,
          total: issues.length,
        })
      }
      pp.phase = 'wikis'
      pp.wikiIndex = 0
      await save()
    }

    // 4. wikis.jsonl（一覧全件 → 各ページ本文+履歴）
    if (pp.phase === 'wikis') {
      const wikisPath = join(dir, 'wikis.jsonl')
      if (pp.wikiIndex === 0) await writeFile(wikisPath, '')
      // Wikiが無効なスペース/プランでは一覧取得が403になるため、スキップして続行する
      let wikiList: BacklogWikiSummary[]
      try {
        wikiList = await this.client.fetchAll<BacklogWikiSummary>('/api/v2/wikis', {
          projectIdOrKey: projectKey,
        })
      } catch (e) {
        if (e instanceof BacklogApiError && e.status === 403) {
          this.emit({
            type: 'phase',
            projectKey,
            phase: 'wikis',
            message: `${projectKey}: Wikiは利用できないためスキップ`,
          })
          wikiList = []
        } else {
          throw e
        }
      }
      this.emit({
        type: 'phase',
        projectKey,
        phase: 'wikis',
        message: `${projectKey}: Wiki取得 (${wikiList.length}ページ)`,
      })
      for (let i = pp.wikiIndex; i < wikiList.length; i++) {
        this.checkAborted()
        const summary = wikiList[i]
        if (summary === undefined) continue
        const wiki = await this.client.requestJson<BacklogWiki>(`/api/v2/wikis/${summary.id}`)
        const history = await this.fetchWikiHistory(summary.id)
        await appendFile(wikisPath, JSON.stringify({ ...wiki, history }) + '\n')
        pp.wikiIndex = i + 1
        pp.wikiCount++
        await save()
        this.emit({
          type: 'progress',
          projectKey,
          phase: 'wikis',
          current: i + 1,
          total: wikiList.length,
        })
      }
      pp.phase = this.options.includeAttachments ? 'attachments' : 'done'
      pp.attachmentIndex = 0
      await save()
    }

    // 5. attachments/（課題・Wikiの添付を1ファイルずつダウンロード）
    if (pp.phase === 'attachments') {
      const targets = await this.collectAttachmentTargets(dir)
      this.emit({
        type: 'phase',
        projectKey,
        phase: 'attachments',
        message: `${projectKey}: 添付ファイル取得 (${targets.length}件)`,
      })
      for (let i = pp.attachmentIndex; i < targets.length; i++) {
        this.checkAborted()
        const t = targets[i]
        if (t === undefined) continue
        const destDir = join(dir, 'attachments', sanitizeFilename(t.ownerKey))
        await mkdir(destDir, { recursive: true })
        const dest = join(destDir, `${t.attachment.id}_${sanitizeFilename(t.attachment.name)}`)
        const { body } = await this.client.download(t.apiPath)
        await writeFile(dest, body)
        pp.attachmentIndex = i + 1
        pp.attachmentCount++
        await save()
        this.emit({
          type: 'progress',
          projectKey,
          phase: 'attachments',
          current: i + 1,
          total: targets.length,
        })
      }
      pp.phase = 'done'
      await save()
    }

    if (pp.phase !== 'done') {
      pp.phase = 'done'
      await save()
    }
  }

  /**
   * Wiki履歴を全件取得する。
   * 履歴APIは count 指定に関わらず最大10件/ページしか返さないため（実地検証済み）、
   * minId（= version 値）で昇順にページングして全件を辿る。
   */
  private async fetchWikiHistory(wikiId: number): Promise<unknown[]> {
    const pageSize = 10
    const all: Array<{ version: number }> = []
    let minId = 0
    for (;;) {
      const page = await this.client.requestJson<Array<{ version: number }>>(
        `/api/v2/wikis/${wikiId}/history`,
        { minId, count: pageSize, order: 'asc' },
      )
      all.push(...page)
      if (page.length < pageSize) break
      minId = Math.max(...page.map((e) => e.version))
    }
    return all
  }

  private projectIdCache = new Map<string, number>()

  private async getProjectId(projectKey: string): Promise<number> {
    const cached = this.projectIdCache.get(projectKey)
    if (cached !== undefined) return cached
    const project = await this.client.requestJson<BacklogProject>(
      `/api/v2/projects/${projectKey}`,
    )
    this.projectIdCache.set(projectKey, project.id)
    return project.id
  }

  private async getIssueCount(projectId: number): Promise<number> {
    const res = await this.client.requestJson<{ count: number }>('/api/v2/issues/count', {
      'projectId[]': projectId,
    })
    return res.count
  }

  private async readIssuesJsonl(projectDir: string): Promise<BacklogIssue[]> {
    try {
      const text = await readFile(join(projectDir, 'issues.jsonl'), 'utf8')
      return text
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((line) => JSON.parse(line) as BacklogIssue)
    } catch {
      return []
    }
  }

  private async collectAttachmentTargets(projectDir: string): Promise<
    Array<{ ownerKey: string; attachment: BacklogAttachment; apiPath: string }>
  > {
    const targets: Array<{ ownerKey: string; attachment: BacklogAttachment; apiPath: string }> =
      []
    const issues = await this.readIssuesJsonl(projectDir)
    for (const issue of issues) {
      for (const att of issue.attachments ?? []) {
        targets.push({
          ownerKey: issue.issueKey,
          attachment: att,
          apiPath: `/api/v2/issues/${issue.issueKey}/attachments/${att.id}`,
        })
      }
    }
    try {
      const text = await readFile(join(projectDir, 'wikis.jsonl'), 'utf8')
      for (const line of text.split('\n')) {
        if (line.trim() === '') continue
        const wiki = JSON.parse(line) as BacklogWiki
        for (const att of wiki.attachments ?? []) {
          targets.push({
            ownerKey: String(wiki.id),
            attachment: att,
            apiPath: `/api/v2/wikis/${wiki.id}/attachments/${att.id}`,
          })
        }
      }
    } catch {
      // wikis.jsonl がない場合は無視
    }
    return targets
  }
}
