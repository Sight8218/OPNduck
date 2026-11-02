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
import { host, type AppSettings } from '../host'

const FORMATS = ['MP4', 'MKV', 'WEBM', 'MOV', 'AVI', 'MP3', 'FLAC', 'WAV']
const QUALITIES = [
  { value: 'best', label: 'Best' },
  { value: '2160', label: '2160p' },
  { value: '1440', label: '1440p' },
  { value: '1080', label: '1080p' },
  { value: '720', label: '720p' },
  { value: '480', label: '480p' },
]

// @category: settings/send-to-opnduck
/** Settings > Send to OPNduck: accept links from other devices, and say what happens to them. */
export default function SendToOpnduckCard() {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    host.settings?.get().then(setSettings)
  }, [])

  async function change(patch: Partial<Pick<AppSettings, 'remoteEnabled' | 'remoteMode' | 'remoteFormat' | 'remoteVideoQuality'>>) {
    setError('')
    try {
      const next = await host.settings!.set(patch)
      setSettings(next)
    } catch (e) {
      setError((e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']*': (Error: )?/, ''))
    }
  }
  if (!settings) return null

  const audio = ['MP3', 'FLAC', 'WAV'].includes(settings.remoteFormat)
  return (
    <div className="glass rounded-3xl p-5">
      <h2 className="mb-1 text-base font-bold">Send to OPNduck</h2>
      <p className="mb-2 text-xs text-[var(--text-dim)]">Send a link from your phone, a browser or another computer, and OPNduck downloads it. Only the link travels; the format and folder always come from here.</p>
      <label className="flex cursor-pointer items-start gap-3 py-2">
        <input type="checkbox" className="mt-0.5 accent-[var(--accent)]" checked={settings.remoteEnabled} onChange={(e) => void change({ remoteEnabled: e.target.checked })} />
        <span>
          <span className="text-sm font-medium">Accept links from other devices</span>
          <span className="block text-[11px] text-[var(--text-dim)]">Includes <code>opnduck://send?url=…</code> links from web pages (these always wait for your click). Off by default.</span>
        </span>
      </label>
      {settings.remoteEnabled && (
        <div className="flex flex-col gap-3 border-t border-[var(--glass-border)] pt-3">
          <div>
            <span className="mb-1 block text-xs font-medium text-[var(--text-dim)]">When a link arrives</span>
            <div className="flex flex-wrap gap-1.5">
              {[
                { v: 'ask' as const, l: 'Ask me first' },
                { v: 'auto' as const, l: 'Download straight away' },
              ].map((o) => (
                <button key={o.v} type="button" aria-pressed={settings.remoteMode === o.v} onClick={() => void change({ remoteMode: o.v })} className={`rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${settings.remoteMode === o.v ? 'border-[var(--input-border-focus)] bg-[var(--input-bg)] text-[var(--accent)]' : 'border-[var(--glass-border)] text-[var(--text-dim)] hover:text-[var(--text)]'}`}>
                  {o.l}
                </button>
              ))}
            </div>
            {settings.remoteMode === 'auto' && <span className="mt-1 block text-[11px] text-[var(--text-faint)]">Links from paired devices start downloading without asking. Links opened from web pages still ask.</span>}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="remote-format" className="mb-1 block text-xs font-medium text-[var(--text-dim)]">Download as</label>
              <select id="remote-format" className="glass-input" value={settings.remoteFormat} onChange={(e) => void change({ remoteFormat: e.target.value })}>
                {FORMATS.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </div>
            {!audio && (
              <div>
                <label htmlFor="remote-quality" className="mb-1 block text-xs font-medium text-[var(--text-dim)]">Video quality</label>
                <select id="remote-quality" className="glass-input" value={settings.remoteVideoQuality} onChange={(e) => void change({ remoteVideoQuality: e.target.value })}>
                  {QUALITIES.map((q) => (
                    <option key={q.value} value={q.value}>
                      {q.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>
      )}
      {error && <span className="mt-2 block text-xs text-red-400">{error}</span>}
    </div>
  )
}
