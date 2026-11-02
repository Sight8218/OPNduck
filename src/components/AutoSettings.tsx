/*
 * OPNduck — local-first media processing suite.
 * Copyright (C) 2026 Aaron Jonsson
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

import { useEffect, useState } from 'react'
import { host, type AutoSuggestion, type AutoTool } from '../host'

// @category: settings/auto
/**
 * "Auto" for a tool card: measures the first chosen file and sets the card's options to what suits it, then offers
 * "Why these settings?" with the reason for each choice. `onApply` receives the settings by their request names.
 */
export default function AutoSettings({
  tool,
  file,
  container,
  disabled,
  onApply,
}: {
  tool: AutoTool
  file: string | null
  /** For convert: the chosen target format. */
  container?: string
  disabled?: boolean
  onApply: (settings: AutoSuggestion['settings']) => void
}) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<AutoSuggestion | null>(null)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)

  // A different file makes the old reasons wrong.
  useEffect(() => {
    setResult(null)
    setError('')
    setOpen(false)
  }, [file, container])

  async function run() {
    if (!file) return
    setBusy(true)
    setError('')
    try {
      const r = await host.suggestSettings(tool, file, { container })
      setResult(r)
      onApply(r.settings)
      setOpen(r.reasons.length === 0 && r.notes.length > 0)
    } catch (err) {
      setError((err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']*': (Error: )?/, ''))
    } finally {
      setBusy(false)
    }
  }

  if (!host.isDesktop) return null
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="glass-btn" onClick={() => void run()} disabled={disabled || busy || !file} title={file ? 'Look at the file and pick the settings for it' : 'Choose a file first'}>
          {busy ? 'Looking at the file…' : 'Auto'}
        </button>
        {result && (result.reasons.length > 0 || result.notes.length > 0) && (
          <button type="button" className="text-xs text-[var(--accent)] underline underline-offset-2" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            Why these settings?
          </button>
        )}
      </div>
      {error && <span className="text-xs text-red-400">{error}</span>}
      {result && open && (
        <ul className="flex flex-col gap-1 rounded-lg bg-[var(--input-bg)] p-2 text-[11px] text-[var(--text-dim)]">
          {result.reasons.map((r) => (
            <li key={r.setting + String(r.value)}>
              <span className="font-semibold text-[var(--text)]">{r.setting} = {String(r.value)}</span>: {r.because}
            </li>
          ))}
          {result.notes.map((n) => (
            <li key={n.text} className={n.level === 'warn' ? 'text-red-400' : ''}>
              {n.level === 'warn' ? 'Careful: ' : 'Note: '}
              {n.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
