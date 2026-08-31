import { useEffect, useState } from 'react'
import {
  fetchProjects,
  fetchStatus,
  checkResumable,
  pickFolder,
  type ProjectSummary,
} from '../api'
import type { ExportConfig } from '../App'

export function SelectStep({
  spaceName,
  onStart,
  onBack,
}: {
  spaceName: string
  onStart: (config: ExportConfig) => void
  onBack: () => void
}) {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [includeAttachments, setIncludeAttachments] = useState(true)
  const [outputDir, setOutputDir] = useState('')
  const [resumable, setResumable] = useState(false)
  const [error, setError] = useState('')

  const loadProjects = () => {
    setLoadError(null)
    setProjects(null)
    void fetchProjects()
      .then((result) => {
        if (result.ok) {
          setProjects(result.projects)
        } else {
          setLoadError(result.error)
        }
      })
      .catch((e: unknown) => {
        setLoadError(e instanceof Error ? e.message : String(e))
      })
  }

  useEffect(() => {
    loadProjects()
    // 出力先のデフォルト値をサーバーから取得して自動入力
    void fetchStatus().then((s) => {
      if (s.defaultOutputDir) {
        setOutputDir((prev) => (prev === '' ? s.defaultOutputDir! : prev))
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [pickError, setPickError] = useState('')

  const browseFolder = async () => {
    setPickError('')
    const result = await pickFolder()
    if (result.ok) {
      if (result.path) setOutputDir(result.path)
      // nullはキャンセル: 何もしない
    } else {
      setPickError(
        `フォルダ選択ダイアログを開けませんでした（${result.error ?? '不明なエラー'}）。パスを直接入力してください。`,
      )
    }
  }

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
        <button
          type="button"
          onClick={onBack}
          className="ml-2 text-xs font-medium text-blue-600 underline"
        >
          別のスペースに接続し直す
        </button>
      </p>

      <div>
        <h2 className="text-sm font-medium text-gray-700">プロジェクト</h2>
        {loadError !== null ? (
          <div className="mt-2 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700">
            <p className="m-0">プロジェクト一覧の取得に失敗しました: {loadError}</p>
            <div className="mt-2 flex gap-2">
              <button
                onClick={loadProjects}
                className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white"
              >
                再試行
              </button>
              <button
                onClick={onBack}
                className="rounded border border-gray-300 bg-white px-3 py-1.5 text-xs text-gray-700"
              >
                接続画面に戻る
              </button>
            </div>
          </div>
        ) : projects === null ? (
          <p className="mt-2 text-sm text-gray-500">読み込み中…</p>
        ) : projects.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">プロジェクトが見つかりません</p>
        ) : (
          <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto rounded border border-gray-200 p-2">
            {projects.map((p) => (
              <li key={p.projectKey}>
                <label
                  className={
                    'flex items-center gap-2 rounded px-2 py-1 text-sm ' +
                    (p.joined ? 'hover:bg-gray-50' : 'cursor-not-allowed opacity-60')
                  }
                >
                  <input
                    type="checkbox"
                    checked={selected.has(p.projectKey)}
                    disabled={!p.joined}
                    onChange={() => toggle(p.projectKey)}
                  />
                  <span className="font-mono text-xs text-gray-500">{p.projectKey}</span>
                  <span>{p.name}</span>
                  {p.archived && (
                    <span className="rounded bg-gray-200 px-1 text-xs text-gray-600">
                      アーカイブ済み
                    </span>
                  )}
                  {!p.joined && (
                    <span className="rounded bg-amber-100 px-1 text-xs text-amber-800">
                      未参加
                    </span>
                  )}
                </label>
              </li>
            ))}
          </ul>
        )}
        {projects?.some((p) => !p.joined) && (
          <p className="mt-2 text-xs text-gray-500">
            「未参加」のプロジェクトは、Backlogの仕様によりメンバーでないユーザー（管理者を含む）は
            データを取得できないため選択できません。エクスポートするには、Backlog側で
            そのプロジェクトに参加してから再度お試しください。
          </p>
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
        <div className="mt-1 flex gap-2">
          <input
            type="text"
            value={outputDir}
            onChange={(e) => setOutputDir(e.target.value)}
            placeholder="/Users/you/backlog-export"
            className="w-full rounded border border-gray-300 px-3 py-2 font-mono text-sm"
          />
          <button
            type="button"
            onClick={() => void browseFolder()}
            className="shrink-0 rounded border border-gray-300 px-3 py-2 text-sm text-gray-700"
          >
            選択…
          </button>
        </div>
        {pickError !== '' && <p className="mt-1 text-xs text-red-600">{pickError}</p>}
        <p className="mt-1 text-xs text-gray-500">
          存在しないフォルダを指定した場合は自動で作成されます。
        </p>
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
