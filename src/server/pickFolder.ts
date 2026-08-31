import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * 出力先のデフォルト値。デスクトップ（なければホーム）配下の backlog-export。
 */
export function defaultOutputDir(): string {
  const desktop = join(homedir(), 'Desktop')
  const base = existsSync(desktop) ? desktop : homedir()
  return join(base, 'backlog-export')
}

/** コマンドを実行し、成功時はstdout、失敗（キャンセル含む）時はnullを返す。
 * コマンド自体が存在しない場合はエラーを投げる。 */
function run(cmd: string, args: string[]): Promise<string | null> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 5 * 60 * 1000 }, (error, stdout) => {
      if (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          reject(new Error(`${cmd} が見つかりません`))
        } else {
          resolve(null) // キャンセル等
        }
        return
      }
      resolve(stdout.toString())
    })
  })
}

/**
 * OSネイティブのフォルダ選択ダイアログを開く（npx実行時用。Electron版は
 * createAppにElectronのdialogベースの実装を注入する）。
 * キャンセル時は null。ダイアログを出せない環境ではエラーを投げる。
 */
export async function pickFolderNative(): Promise<string | null> {
  if (process.platform === 'darwin') {
    const out = await run('osascript', [
      '-e',
      'POSIX path of (choose folder with prompt "エクスポートの出力先フォルダを選択してください")',
    ])
    return out === null ? null : out.trim().replace(/\/$/, '')
  }
  if (process.platform === 'win32') {
    const script = [
      'Add-Type -AssemblyName System.Windows.Forms',
      '$d = New-Object System.Windows.Forms.FolderBrowserDialog',
      '$d.Description = "エクスポートの出力先フォルダを選択してください"',
      '$d.ShowNewFolderButton = $true',
      'if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $d.SelectedPath }',
    ].join('; ')
    const out = await run('powershell', ['-NoProfile', '-STA', '-Command', script])
    const path = out?.trim() ?? ''
    return path === '' ? null : path
  }
  // Linux: zenityがあれば使う（なければエラー → GUIは手入力を案内）
  const out = await run('zenity', [
    '--file-selection',
    '--directory',
    '--title=エクスポートの出力先フォルダを選択してください',
  ])
  return out === null ? null : out.trim()
}
