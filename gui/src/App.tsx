import { useState } from 'react'
import { ConnectStep } from './steps/ConnectStep'
import { SelectStep } from './steps/SelectStep'
import { RunStep } from './steps/RunStep'
import { DoneStep } from './steps/DoneStep'

export type Step = 'connect' | 'select' | 'run' | 'done'

export interface ExportConfig {
  projectKeys: string[]
  outputDir: string
  includeAttachments: boolean
}

const STEP_LABELS: Array<{ key: Step; label: string }> = [
  { key: 'connect', label: '1. 接続' },
  { key: 'select', label: '2. プロジェクト選択' },
  { key: 'run', label: '3. 実行' },
  { key: 'done', label: '4. 完了' },
]

export function App() {
  const [step, setStep] = useState<Step>('connect')
  const [spaceName, setSpaceName] = useState('')
  const [config, setConfig] = useState<ExportConfig | null>(null)

  // 別スペースへの接続し直し（実行中以外のどの画面からでも）
  const backToConnect = () => {
    setSpaceName('')
    setConfig(null)
    setStep('connect')
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <header className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">bckle</h1>
        <p className="mt-1 text-sm text-gray-600">
          Backlogのデータをあなた自身のPCにエクスポートします
        </p>
        <nav className="mt-4 flex gap-2 text-sm">
          {STEP_LABELS.map((s) => (
            <span
              key={s.key}
              className={
                'rounded px-3 py-1 ' +
                (s.key === step
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-500')
              }
            >
              {s.label}
            </span>
          ))}
        </nav>
      </header>
      <main>
        {step === 'connect' && (
          <ConnectStep
            onConnected={(name) => {
              setSpaceName(name)
              setStep('select')
            }}
          />
        )}
        {step === 'select' && (
          <SelectStep
            spaceName={spaceName}
            onStart={(c) => {
              setConfig(c)
              setStep('run')
            }}
            onBack={backToConnect}
          />
        )}
        {step === 'run' && config && (
          <RunStep
            config={config}
            onDone={() => setStep('done')}
            onBack={() => setStep('select')}
          />
        )}
        {step === 'done' && config && (
          <DoneStep
            outputDir={config.outputDir}
            onRestart={() => setStep('select')}
            onReconnect={backToConnect}
          />
        )}
      </main>
    </div>
  )
}
