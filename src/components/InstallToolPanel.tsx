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
import { host, type PythonTool } from '../host'

// @category: app/python-tool-install
/** "Install automatically" for a missing Python tool: runs the install, shows pip's latest line, and
 *  offers Cancel. `onInstalled` re-runs the card's own availability check. Under it, the manual
 *  command stays visible for people who'd rather run it themselves. */
export default function InstallToolPanel({
  tool,
  sizeNote,
  hint,
  onInstalled,
}: {
  tool: PythonTool
  sizeNote: string
  hint: string
  onInstalled: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [line, setLine] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Leaving the page doesn't stop the install; coming back just shows the button again once it ends.
  useEffect(() => () => setBusy(false), [])

  async function install() {
    setBusy(true)
    setError(null)
    setLine('Starting…')
    const res = await host.installTool(tool, setLine)
    setBusy(false)
    if (res.ok) onInstalled()
    else setError(res.error ?? 'The install failed.')
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <button type="button" className="glass-btn px-3 py-1.5 text-xs" onClick={install} disabled={busy}>
          {busy ? 'Installing…' : `Install automatically (${sizeNote})`}
        </button>
        {busy && (
          <button type="button" className="glass-btn px-3 py-1.5 text-xs" onClick={() => void host.cancelInstall()}>
            Cancel
          </button>
        )}
      </div>
      {busy && <span className="truncate font-mono text-[11px] text-[var(--text-dim)]">{line}</span>}
      {error && <pre className="max-h-32 overflow-auto whitespace-pre-wrap text-[11px] text-red-400">{error}</pre>}
      <span className="text-[11px] text-[var(--text-faint)]">Or by hand:</span>
      <code className="select-all rounded-md bg-[var(--bg-solid)] px-2 py-1 font-mono text-[11px] text-[var(--text)]">{hint}</code>
    </div>
  )
}
// --- end: app/python-tool-install ---
