import { useEffect, useRef, useState } from 'react'
import { abortExport, startExport } from '../api'
import type { ExportConfig } from '../App'

interface ProgressState {
  projectKey: string
  phase: string
  current: number
  total: number | null
}

const PHASE_LABELS: Record<string, string> = {
  manifest: 'マニフェスト',
  users: 'ユーザー',
  project: 'プロジェクト設定',
  issues: '課題',
  comments: 'コメント',
  wikis: 'Wiki',
  attachments: '添付ファイル',
}

export function RunStep({
  config,
  onDone,
  onBack,
}: {
  config: ExportConfig
  onDone: () => void
  onBack: () => void
}) {
  const [messages, setMessages] = useState<string[]>([])
  const [progress, setProgress] = useState<Record<string, ProgressState>>({})
  const [doneProjects, setDoneProjects] = useState<Set<string>>(new Set())
  const [waiting, setWaiting] = useState<{ resumeAt: number } | null>(null)
  const [status, setStatus] = useState<'starting' | 'running' | 'aborted' | 'error'>('starting')
  const [errorMessage, setErrorMessage] = useState('')
  const startedRef = useRef(false)

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true

    let eventSource: EventSource | null = null

    void (async () => {
      const result = await startExport(config)
      if (!result.ok) {
        setStatus('error')
        setErrorMessage(result.error ?? 'エクスポートを開始できませんでした')
        return
      }
      setStatus('running')
      eventSource = new EventSource('/api/export/events')

      eventSource.addEventListener('phase', (e) => {
        const data = JSON.parse(e.data) as { message: string }
        setMessages((prev) => [...prev.slice(-49), data.message])
        setWaiting(null)
      })
      eventSource.addEventListener('progress', (e) => {
        const data = JSON.parse(e.data) as ProgressState
        setProgress((prev) => ({
          ...prev,
          [`${data.projectKey}:${data.phase}`]: data,
        }))
        setWaiting(null)
      })
      eventSource.addEventListener('rateLimitWait', (e) => {
        const data = JSON.parse(e.data) as { resumeAt: number }
        setWaiting({ resumeAt: data.resumeAt })
      })
      eventSource.addEventListener('projectDone', (e) => {
        const data = JSON.parse(e.data) as { projectKey: string }
        setDoneProjects((prev) => new Set(prev).add(data.projectKey))
      })
      eventSource.addEventListener('done', () => {
        eventSource?.close()
        onDone()
      })
      eventSource.addEventListener('aborted', () => {
        eventSource?.close()
        setStatus('aborted')
      })
      eventSource.addEventListener('error', (e) => {
        if (e instanceof MessageEvent && typeof e.data === 'string') {
          const data = JSON.parse(e.data) as { message: string }
          setErrorMessage(data.message)
          setStatus('error')
          eventSource?.close()
        }
      })
      eventSource.addEventListener('end', () => {
        eventSource?.close()
      })
    })()

    return () => {
      eventSource?.close()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const abort = async () => {
    await abortExport()
  }

  const totalProjects = config.projectKeys.length
  const overallPercent = Math.round((doneProjects.size / totalProjects) * 100)

  return (
    <div className="space-y-6">
      <div>
        <div className="flex justify-between text-sm text-gray-700">
          <span>全体の進捗（プロジェクト単位）</span>
          <span>
            {doneProjects.size} / {totalProjects}
          </span>
        </div>
        <div className="mt-1 h-3 w-full overflow-hidden rounded bg-gray-200">
          <div
            className="h-full bg-blue-600 transition-all"
            style={{ width: `${overallPercent}%` }}
          />
        </div>
      </div>

      {waiting && (
        <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          レート制限に達したため待機中です（
          {new Date(waiting.resumeAt).toLocaleTimeString()} 頃に再開予定）
        </div>
      )}

      <div className="space-y-2">
        {config.projectKeys.map((key) => (
          <div key={key} className="rounded border border-gray-200 p-3">
            <div className="flex items-center justify-between text-sm">
              <span className="font-mono">{key}</span>
              {doneProjects.has(key) && <span className="text-green-600">完了</span>}
            </div>
            <ul className="mt-1 space-y-0.5 text-xs text-gray-600">
              {Object.values(progress)
                .filter((p) => p.projectKey === key)
                .map((p) => (
                  <li key={p.phase}>
                    {PHASE_LABELS[p.phase] ?? p.phase}: {p.current}
                    {p.total !== null ? ` / ${p.total}` : ''}
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="max-h-40 overflow-y-auto rounded bg-gray-900 p-3 font-mono text-xs text-gray-100">
        {messages.length === 0 ? <p>開始しています…</p> : messages.map((m, i) => <p key={i}>{m}</p>)}
      </div>

      {status === 'error' && (
        <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          エラーが発生しました: {errorMessage}
          <p className="mt-1 text-xs">
            同じ出力先を指定して再実行すると、途中から再開できます。
          </p>
        </div>
      )}

      {status === 'aborted' && (
        <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          エクスポートを中断しました。進捗は出力先に保存されています。
          同じ出力先を指定して再実行すると、途中から再開できます。
        </div>
      )}

      <div className="flex gap-2">
        {status === 'running' && (
          <button
            onClick={abort}
            className="rounded border border-gray-300 px-4 py-2 text-sm text-gray-700"
          >
            中断する
          </button>
        )}
        {(status === 'aborted' || status === 'error') && (
          <button
            onClick={onBack}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white"
          >
            選択画面に戻る（再開できます）
          </button>
        )}
      </div>
    </div>
  )
}
