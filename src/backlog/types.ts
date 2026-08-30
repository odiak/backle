/** Backlog APIレスポンスの最小限の型（エクスポートは生データ保持のため大半は unknown 透過） */

export interface BacklogSpace {
  spaceKey: string
  name: string
  [key: string]: unknown
}

export interface BacklogUser {
  id: number
  userId?: string | null
  name: string
  mailAddress?: string | null
  [key: string]: unknown
}

export interface BacklogProject {
  id: number
  projectKey: string
  name: string
  archived?: boolean
  [key: string]: unknown
}

export interface BacklogIssue {
  id: number
  issueKey: string
  summary: string
  attachments?: BacklogAttachment[]
  [key: string]: unknown
}

export interface BacklogComment {
  id: number
  [key: string]: unknown
}

export interface BacklogWikiSummary {
  id: number
  name: string
  [key: string]: unknown
}

export interface BacklogWiki extends BacklogWikiSummary {
  content?: string
  attachments?: BacklogAttachment[]
  [key: string]: unknown
}

export interface BacklogAttachment {
  id: number
  name: string
  size?: number
  [key: string]: unknown
}
