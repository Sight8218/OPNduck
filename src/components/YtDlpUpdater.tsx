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
import { host, type ToolStatus } from '../host'

// @category: app/ytdlp-updater
/** yt-dlp status with a one-click install/update of OPNduck's own copy (no admin rights needed).
 *  `compact` shows only the button + result, for the Downloader card's "not installed" banner. */
export default function YtDlpUpdater({ compact = false, onChanged }: { compact?: boolean; onChanged?: (s: ToolStatus) => void }) {
  const [status, setStatus] = useState<ToolStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    host.checkYtDlp().then(setStatus)
  }, [])

  async function install() {
    setBusy(true)
    setMessage(null)
    const res = await host.installYtDlp()
    const next = await host.checkYtDlp()
    setStatus(next)
    setBusy(false)
    if (res.ok) {
      setMessage({ ok: true, text: `yt-dlp ${next.version ?? ''} is ready.`.replace('  ', ' ') })
      onChanged?.(next)
    } else {
      setMessage({ ok: false, text: res.error ?? 'The download failed.' })
    }
  }

  if (!host.isDesktop) return null
  return (
    <div className="flex flex-col gap-1">
      {!compact && status && (
        <span className="text-xs text-[var(--text-dim)]">
          {status.available ? `yt-dlp ${status.version ?? ''} (${status.managed ? 'OPNduck’s own copy' : 'system'})` : 'yt-dlp is not installed'}
        </span>
      )}
      <div className="flex items-center gap-2">
        <button type="button" className="glass-btn px-3 py-1.5 text-xs" onClick={install} disabled={busy}>
          {busy ? 'Downloading…' : status?.available ? 'Update yt-dlp' : 'Install yt-dlp automatically'}
        </button>
        {message && <span className={`text-xs ${message.ok ? 'text-[var(--text-dim)]' : 'text-red-400'}`}>{message.text}</span>}
      </div>
    </div>
  )
}
// --- end: app/ytdlp-updater ---
