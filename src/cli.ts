#!/usr/bin/env node
import { serve } from '@hono/node-server'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp } from './server/app.js'

const PORT = Number(process.env.TASKAME_EXPORT_PORT ?? 7810)

const here = dirname(fileURLToPath(import.meta.url))
// ビルド後の配置: dist/cli.js と dist/gui/
const guiDir = join(here, 'gui')

if (!existsSync(join(guiDir, 'index.html'))) {
  console.error(
    `GUIのビルド成果物が見つかりません: ${guiDir}\n` +
      '開発時は `pnpm build:gui` を先に実行してください。',
  )
}

const { app } = createApp({ guiDir })

serve({ fetch: app.fetch, port: PORT, hostname: '127.0.0.1' }, (info) => {
  const url = `http://localhost:${info.port}`
  console.log(`taskame-export を起動しました: ${url}`)
  console.log('データはあなたのPCの外には送信されません。終了するには Ctrl+C を押してください。')
  openBrowser(url)
})

function openBrowser(url: string): void {
  const platform = process.platform
  const cmd =
    platform === 'darwin' ? 'open' : platform === 'win32' ? 'cmd' : 'xdg-open'
  const args = platform === 'win32' ? ['/c', 'start', '', url] : [url]
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true })
    child.unref()
  } catch {
    console.log(`ブラウザで ${url} を開いてください。`)
  }
}
