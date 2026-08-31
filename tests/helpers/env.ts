import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 結合テスト用の環境変数を取得する。
 * プロセスの環境変数を優先し、なければリポジトリ直下の .env を読む（依存なしの簡易パーサ）。
 */
export function loadTestEnv(): { domain: string; apiKey: string } | null {
  const fromDotenv = readDotenv()
  const domain = process.env.BACKLOG_DOMAIN ?? fromDotenv.BACKLOG_DOMAIN
  const apiKey = process.env.BACKLOG_API_KEY ?? fromDotenv.BACKLOG_API_KEY
  if (!domain || !apiKey) return null
  return { domain, apiKey }
}

function readDotenv(): Record<string, string> {
  try {
    const here = dirname(fileURLToPath(import.meta.url))
    const text = readFileSync(join(here, '..', '..', '.env'), 'utf8')
    const result: Record<string, string> = {}
    for (const line of text.split('\n')) {
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line)
      if (m?.[1] === undefined || m[2] === undefined) continue
      result[m[1]] = m[2].replace(/^(["'])(.*)\1$/, '$2')
    }
    return result
  } catch {
    return {}
  }
}
