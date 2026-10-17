import { useState } from 'react'
import SlidingSelector, { type SelectorOption } from './SlidingSelector'
import { host, type UpdateCheck } from '../host'
import { getAutoCheck, setAutoCheck } from '../lib/updatePrefs'

const ON_OFF: SelectorOption<'on' | 'off'>[] = [
  { value: 'on', label: 'On' },
  { value: 'off', label: 'Off' },
]

/** Settings > System: automatic update check on launch, plus a manual "Check now". */
export default function UpdatesCard() {
  const [auto, setAuto] = useState(getAutoCheck)
  const [checking, setChecking] = useState(false)
  const [result, setResult] = useState<UpdateCheck | null>(null)

  if (!host.updates) return null

  async function checkNow() {
    setChecking(true)
    try {
      setResult(await host.updates!.check())
    } catch (err) {
      setResult({ current: '', latest: null, newer: false, error: err instanceof Error ? err.message : String(err) })
    } finally {
      setChecking(false)
    }
  }

  let status: string | null = null
  if (result) {
    if (result.error) status = `Couldn't reach GitHub (${result.error}).`
    else if (result.newer && result.latest) status = `${result.latest.tag} is available — you're on v${result.current}.`
    else status = `You're up to date (v${result.current}).`
  }

  return (
    <div className="glass rounded-3xl p-5">
      <h2 className="mb-1 text-base font-bold">Updates</h2>
      <p className="mb-4 text-xs text-[var(--text-dim)]">
        OPNduck asks GitHub whether a newer release exists and lets you choose whether to download it.
        Nothing is installed automatically.
      </p>
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-sm font-medium">Check for updates on launch</span>
          <SlidingSelector<'on' | 'off'>
            id="update-auto"
            options={ON_OFF}
            value={auto ? 'on' : 'off'}
            onChange={(v) => {
              setAuto(v === 'on')
              setAutoCheck(v === 'on')
            }}
            className="w-full grid-cols-2 sm:w-32"
          />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="glass-btn" onClick={checkNow} disabled={checking}>
            {checking ? 'Checking…' : 'Check now'}
          </button>
          {status && <span className="text-xs text-[var(--text-dim)]">{status}</span>}
          {result?.newer && result.latest && (
            <button
              type="button"
              className="glass-btn"
              onClick={() => host.updates!.openRelease(result.latest!.url)}
            >
              Download
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
