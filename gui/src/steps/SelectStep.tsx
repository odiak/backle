import { useEffect, useState } from 'react'
import { fetchProjects, checkResumable, type ProjectSummary } from '../api'
import type { ExportConfig } from '../App'

export function SelectStep({
  spaceName,
  onStart,
}: {
  spaceName: string
  onStart: (config: ExportConfig) => void
}) {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [includeAttachments, setIncludeAttachments] = useState(true)
  const [outputDir, setOutputDir] = useState('')
  const [resumable, setResumable] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    void fetchProjects().then((result) => {
      if (result.ok) {
        setProjects(result.projects)
      } else {
        setError(result.error)
      }
    })
  }, [])

  useEffect(() => {
    if (outputDir.trim() === '') {
      setResumable(false)
      return
    }
    const timer = setTimeout(() => {
      void checkResumable(outputDir.trim()).then((r) => setResumable(r.resumable ?? false))
    }, 500)
    return () => clearTimeout(timer)
  }, [outputDir])

  const toggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const submit = () => {
    if (selected.size === 0) {
      setError('プロジェクトを1つ以上選択してください')
      return
    }
    if (outputDir.trim() === '') {
      setError('出力先フォルダを入力してください')
      return
    }
    onStart({
      projectKeys: [...selected],
      outputDir: outputDir.trim(),
      includeAttachments,
    })
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-gray-600">
        スペース「{spaceName}」に接続しました。エクスポートするプロジェクトを選択してください。
      </p>

      <div>
        <h2 className="text-sm font-medium text-gray-700">プロジェクト</h2>
        {projects === null ? (
          <p className="mt-2 text-sm text-gray-500">読み込み中…</p>
        ) : projects.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">プロジェクトが見つかりません</p>
        ) : (
          <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto rounded border border-gray-200 p-2">
            {projects.map((p) => (
              <li key={p.projectKey}>
                <label className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-gray-50">
                  <input
                    type="checkbox"
                    checked={selected.has(p.projectKey)}
                    onChange={() => toggle(p.projectKey)}
                  />
                  <span className="font-mono text-xs text-gray-500">{p.projectKey}</span>
                  <span>{p.name}</span>
                  {p.archived && (
                    <span className="rounded bg-gray-200 px-1 text-xs text-gray-600">
                      アーカイブ済み
                    </span>
                  )}
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>

      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input
          type="checkbox"
          checked={includeAttachments}
          onChange={(e) => setIncludeAttachments(e.target.checked)}
        />
        添付ファイルを含める
      </label>

      <div>
        <label className="block text-sm font-medium text-gray-700">出力先フォルダ</label>
        <input
          type="text"
          value={outputDir}
          onChange={(e) => setOutputDir(e.target.value)}
          placeholder="/Users/you/backlog-export"
          className="mt-1 w-full rounded border border-gray-300 px-3 py-2 font-mono text-sm"
        />
        {resumable && (
          <p className="mt-1 text-xs text-amber-700">
            このフォルダには中断されたエクスポートの進捗があります。開始すると続きから再開します。
          </p>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        onClick={submit}
        className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white"
      >
        {resumable ? 'エクスポートを再開する' : 'エクスポートを開始する'}
      </button>
    </div>
  )
}
