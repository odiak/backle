export function DoneStep({
  outputDir,
  onRestart,
}: {
  outputDir: string
  onRestart: () => void
}) {
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

      <button
        onClick={onRestart}
        className="rounded border border-gray-300 px-4 py-2 text-sm text-gray-700"
      >
        別のプロジェクトをエクスポートする
      </button>
    </div>
  )
}
