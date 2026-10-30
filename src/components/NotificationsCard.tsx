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

// @category: settings/notifications
/** Settings > Notifications & tray: finish notifications, and keeping OPNduck running in the tray. */
export default function NotificationsCard() {
  const [settings, setSettings] = useState<AppSettings | null>(null)

  useEffect(() => {
    host.settings?.get().then(setSettings)
  }, [])

  function change(patch: { notifyOnFinish?: boolean; runInTray?: boolean }) {
    setSettings((s) => (s ? { ...s, ...patch } : s))
    void host.settings?.set(patch)
  }
  if (!settings) return null

  const row = 'flex cursor-pointer items-start gap-3 py-3'
  return (
    <div className="glass rounded-3xl p-5">
      <h2 className="mb-1 text-base font-bold">Notifications &amp; tray</h2>
      <p className="mb-2 text-xs text-[var(--text-dim)]">Know when long jobs are done without watching the window.</p>
      <label className={row}>
        <input type="checkbox" className="mt-0.5 accent-[var(--accent)]" checked={settings.notifyOnFinish} onChange={(e) => change({ notifyOnFinish: e.target.checked })} />
        <span>
          <span className="text-sm font-medium">Notify me when jobs finish</span>
          <span className="block text-[11px] text-[var(--text-dim)]">Only when OPNduck isn't the focused window. A batch becomes one notification.</span>
        </span>
      </label>
      <label className={`${row} border-t border-[var(--glass-border)]`}>
        <input type="checkbox" className="mt-0.5 accent-[var(--accent)]" checked={settings.runInTray} onChange={(e) => change({ runInTray: e.target.checked })} />
        <span>
          <span className="text-sm font-medium">Keep running in the tray when I close the window</span>
          <span className="block text-[11px] text-[var(--text-dim)]">Jobs and subscription checks continue. Use the tray icon's Quit to exit. Needs a system tray (most desktops have one).</span>
        </span>
      </label>
    </div>
  )
}
// --- end: settings/notifications ---
