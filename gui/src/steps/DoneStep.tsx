import { useState } from 'react'
import { openOutputFolder } from '../api'

export function DoneStep({
  outputDir,
  onRestart,
  onReconnect,
}: {
  outputDir: string
  onRestart: () => void
  onReconnect: () => void
}) {
  const [openError, setOpenError] = useState<string | null>(null)

  return (
    <div className="space-y-6">
      <div className="rounded border border-green-300 bg-green-50 p-4">
        <h2 className="font-medium text-green-800">エクスポートが完了しました</h2>
        <p className="mt-2 text-sm text-green-800">
          出力先: <code className="rounded bg-white px-1 py-0.5 font-mono">{outputDir}</code>
        </p>
      </div>

      <p className="text-sm text-gray-600">
        エクスポートされたデータはすべて上記フォルダに保存されています。
        形式の仕様は同梱の docs/format-v1.md を参照してください。
      </p>

      <div className="flex gap-3">
        <button
          onClick={() => {
            void openOutputFolder().then((res) => {
              setOpenError(res.ok ? null : (res.error ?? 'フォルダを開けませんでした'))
            })
          }}
          className="rounded bg-blue-600 px-4 py-2 text-sm text-white"
        >
          出力フォルダを開く
        </button>
        <button
          onClick={onRestart}
          className="rounded border border-gray-300 px-4 py-2 text-sm text-gray-700"
        >
          別のプロジェクトをエクスポートする
        </button>
        <button
          onClick={onReconnect}
          className="rounded border border-gray-300 px-4 py-2 text-sm text-gray-700"
        >
          別のスペースに接続する
        </button>
      </div>
      {openError !== null && <p className="text-sm text-red-600">{openError}</p>}
    </div>
  )
}
