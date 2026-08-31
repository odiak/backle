/**
 * Electron版のエントリポイント。
 * npx版と同じHonoサーバーをmainプロセス内で起動し、BrowserWindowでGUIを表示する。
 * コアは完全に共通で、Electronは「配布の皮」に徹する。
 */
import { serve, type ServerType } from '@hono/node-server'
import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { createApp } from '../src/server/app.js'

let server: ServerType | null = null

function startServer(): Promise<number> {
  // GUIのビルド成果物はパッケージ内の dist/gui にある
  const guiDir = join(app.getAppPath(), 'dist', 'gui')
  const { app: hono } = createApp({ guiDir })
  return new Promise((resolve) => {
    // 既定はポート0（OSに空きポートを割り当てさせ、npx版の7810と衝突しない）
    const port = Number(process.env.BACKLE_PORT ?? 0)
    server = serve({ fetch: hono.fetch, port, hostname: '127.0.0.1' }, (info) => {
      resolve(info.port)
    })
  })
}

async function createWindow(): Promise<void> {
  const port = await startServer()
  const win = new BrowserWindow({
    width: 900,
    height: 720,
    title: 'backle',
    webPreferences: {
      // GUIはlocalhostのサーバーから配信される通常のWebページ。Node統合は不要
      nodeIntegration: false,
      contextIsolation: true,
    },
  })
  await win.loadURL(`http://127.0.0.1:${port}`)
}

void app.whenReady().then(() => {
  void createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow()
  })
})

app.on('window-all-closed', () => {
  // エクスポート中の誤終了を避けるため、全ウィンドウが閉じたら素直に終了する
  // （macOSの慣習より分かりやすさを優先。再度開けばレジュームできる）
  server?.close()
  app.quit()
})
