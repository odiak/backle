import { BacklogClient } from '../backlog/client.js'
import { Exporter, type ExporterEvent } from '../export/exporter.js'

/**
 * サーバープロセス内の状態。
 * APIキーはこのオブジェクト（メモリ）内にのみ保持し、ディスクには一切書かない。
 */
export interface Connection {
  spaceDomain: string
  apiKey: string
  spaceName: string
}

export interface JobEventEntry {
  id: number
  event: ExporterEvent
}

export class ExportJob {
  readonly exporter: Exporter
  readonly events: JobEventEntry[] = []
  private nextEventId = 1
  private waiters: Array<() => void> = []
  status: 'running' | 'done' | 'error' | 'aborted' = 'running'
  readonly outputDir: string

  constructor(exporter: Exporter, outputDir: string) {
    this.exporter = exporter
    this.outputDir = outputDir
    exporter.onEvent((event) => {
      this.events.push({ id: this.nextEventId++, event })
      if (event.type === 'done') this.status = 'done'
      if (event.type === 'error') this.status = 'error'
      if (event.type === 'aborted') this.status = 'aborted'
      const waiters = this.waiters
      this.waiters = []
      for (const w of waiters) w()
    })
  }

  /** lastId より後のイベントが来るまで待つ（SSE配信用） */
  async waitForEvents(lastId: number, timeoutMs = 15000): Promise<JobEventEntry[]> {
    const pending = this.events.filter((e) => e.id > lastId)
    if (pending.length > 0) return pending
    if (this.status !== 'running') return []
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, timeoutMs)
      this.waiters.push(() => {
        clearTimeout(timer)
        resolve()
      })
    })
    return this.events.filter((e) => e.id > lastId)
  }
}

export class AppState {
  connection: Connection | null = null
  client: BacklogClient | null = null
  job: ExportJob | null = null
}
