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
import { host } from '../host'

// @category: settings/plugins
/** Safe-mode switch: starts OPNduck with every plugin skipped. Shown on the Plugins page and in Settings. */
export default function PluginSafeMode() {
  const [on, setOn] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void host.settings?.get().then((s) => setOn(s.pluginsSafeMode === true))
  }, [])

  async function toggle(next: boolean) {
    setBusy(true)
    try {
      await host.settings?.set({ pluginsSafeMode: next })
      setOn(next)
      await host.plugins?.rescan()
    } finally {
      setBusy(false)
    }
  }

  if (on === null || !host.plugins) return null
  return (
    <label className="glass flex cursor-pointer items-start gap-3 rounded-3xl p-4">
      <input type="checkbox" className="mt-0.5 accent-[var(--accent)]" checked={on} disabled={busy} onChange={(e) => void toggle(e.target.checked)} />
      <span>
        <span className="text-sm font-medium">Safe mode</span>
        <span className="block text-[11px] text-[var(--text-dim)]">
          Skip every plugin. Turn this on if a plugin breaks OPNduck, then turn off the one that caused it.
        </span>
      </span>
    </label>
  )
}
// --- end: settings/plugins ---
