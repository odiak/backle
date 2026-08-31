import { readFile, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'

export type ProjectPhase =
  | 'pending'
  | 'project'
  | 'issues'
  | 'comments'
  | 'wikis'
  | 'attachments'
  | 'done'

export interface ProjectProgress {
  phase: ProjectPhase
  /** issues: 次に取得するoffset */
  issueOffset: number
  /** issues.jsonl に書き出した件数 */
  issueCount: number
  /** comments: 処理済み課題数（issues.jsonlの行番号ベース） */
  commentIssueIndex: number
  commentCount: number
  /** wikis: 処理済みWiki数 */
  wikiIndex: number
  wikiCount: number
  /** attachments: 処理済み添付インデックス */
  attachmentIndex: number
  attachmentCount: number
}

export interface ExportProgress {
  formatVersion: '1'
  startedAt: string
  spaceDomain: string
  includeAttachments: boolean
  usersDone: boolean
  /** users.json の取得範囲。space=スペース全体 / projectMembers=選択プロジェクトのメンバーのみ（権限不足時のフォールバック） */
  usersScope?: 'space' | 'projectMembers'
  /** projectKey -> progress */
  projects: Record<string, ProjectProgress>
  projectKeys: string[]
}

export const PROGRESS_FILE = 'progress.json'

export function newProjectProgress(): ProjectProgress {
  return {
    phase: 'pending',
    issueOffset: 0,
    issueCount: 0,
    commentIssueIndex: 0,
    commentCount: 0,
    wikiIndex: 0,
    wikiCount: 0,
    attachmentIndex: 0,
    attachmentCount: 0,
  }
}

export async function loadProgress(outputDir: string): Promise<ExportProgress | null> {
  try {
    const text = await readFile(join(outputDir, PROGRESS_FILE), 'utf8')
    return JSON.parse(text) as ExportProgress
  } catch {
    return null
  }
}

export async function saveProgress(outputDir: string, progress: ExportProgress): Promise<void> {
  const path = join(outputDir, PROGRESS_FILE)
  const tmp = path + '.tmp'
  await writeFile(tmp, JSON.stringify(progress, null, 2))
  await rename(tmp, path)
}
