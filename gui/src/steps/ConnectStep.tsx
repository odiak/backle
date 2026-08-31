import { useEffect, useState } from 'react'
import { connect } from '../api'

export function ConnectStep({ onConnected }: { onConnected: (spaceName: string) => void }) {
  const [subdomain, setSubdomain] = useState('')
  const [tld, setTld] = useState<'backlog.jp' | 'backlog.com'>('backlog.jp')
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [envCredentials, setEnvCredentials] = useState(false)

  useEffect(() => {
    void fetch('/api/status')
      .then((r) => r.json())
      .then((s: { envCredentials?: boolean }) => setEnvCredentials(s.envCredentials ?? false))
      .catch(() => {})
  }, [])

  const connectWithEnv = async () => {
    setBusy(true)
    setError('')
    try {
      const result = await connect('', '')
      if (result.ok && result.spaceName !== undefined) {
        onConnected(result.spaceName)
      } else {
        setError(result.error ?? '接続に失敗しました')
      }
    } finally {
      setBusy(false)
    }
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const result = await connect(`${subdomain.trim()}.${tld}`, apiKey)
      if (result.ok && result.spaceName !== undefined) {
        onConnected(result.spaceName)
      } else {
        setError(result.error ?? '接続に失敗しました')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <div className="rounded border border-green-300 bg-green-50 p-4 text-sm text-green-800">
        このツールはあなたのPC上でのみ動作します。
        <strong>APIキーやエクスポートしたデータが、あなたのPCの外に送信されることはありません。</strong>
        APIキーはメモリ内にのみ保持され、ディスクにも保存されません。
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700">スペースドメイン</label>
        <div className="mt-1 flex items-center gap-2">
          <input
            type="text"
            value={subdomain}
            onChange={(e) => setSubdomain(e.target.value)}
            placeholder="example"
            required
            className="w-48 rounded border border-gray-300 px-3 py-2 text-sm"
          />
          <span className="text-gray-500">.</span>
          <select
            value={tld}
            onChange={(e) => setTld(e.target.value as 'backlog.jp' | 'backlog.com')}
            className="rounded border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="backlog.jp">backlog.jp</option>
            <option value="backlog.com">backlog.com</option>
          </select>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700">APIキー</label>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          required
          className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
        />
        <p className="mt-1 text-xs text-gray-500">
          Backlogの「個人設定 → API」で発行できます。全プロジェクトの取得には管理者権限のキーを推奨します。
        </p>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={busy}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? '接続中…' : '接続する'}
        </button>
        {envCredentials && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void connectWithEnv()}
            className="rounded border border-gray-300 px-4 py-2 text-sm text-gray-700 disabled:opacity-50"
          >
            環境変数の認証情報で接続
          </button>
        )}
      </div>
    </form>
  )
}
