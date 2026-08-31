export interface ProjectSummary {
  id: number
  projectKey: string
  name: string
  archived: boolean
  /** 自分が参加しているか。非参加プロジェクトはBacklogの仕様上データを取得できない */
  joined: boolean
}

export interface ConnectResult {
  ok: boolean
  spaceName?: string
  error?: string
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return (await res.json()) as T
}

export async function connect(spaceDomain: string, apiKey: string): Promise<ConnectResult> {
  return await postJson<ConnectResult>('/api/connect', { spaceDomain, apiKey })
}

export async function fetchProjects(): Promise<
  { ok: true; projects: ProjectSummary[] } | { ok: false; error: string }
> {
  const res = await fetch('/api/projects')
  return await res.json()
}

export async function startExport(options: {
  projectKeys: string[]
  outputDir: string
  includeAttachments: boolean
}): Promise<{ ok: boolean; error?: string }> {
  return await postJson('/api/export/start', options)
}

export async function abortExport(): Promise<{ ok: boolean }> {
  return await postJson('/api/export/abort', {})
}

export async function openOutputFolder(): Promise<{ ok: boolean; error?: string }> {
  return await postJson('/api/open-output', {})
}

export async function checkResumable(
  outputDir: string,
): Promise<{ ok: boolean; resumable?: boolean }> {
  const res = await fetch(
    `/api/export/resumable?outputDir=${encodeURIComponent(outputDir)}`,
  )
  return await res.json()
}
