import { defineConfig } from 'vitest/config'

// 実Backlogスペースに接続する結合テスト用の設定。
// `pnpm test:integration` で実行する（.env / 環境変数が未設定ならスキップ）。
export default defineConfig({
  test: {
    include: ['tests/**/*.integration.ts'],
    environment: 'node',
    testTimeout: 10 * 60 * 1000,
    hookTimeout: 60 * 1000,
    // 実APIを叩くため直列で実行する
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
})
