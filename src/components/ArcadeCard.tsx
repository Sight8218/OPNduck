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
import { setArcadePinned, useArcadePinned, useArcadeUnlocked } from '../lib/arcadeStore'

// @category: settings/arcade
/** Settings > Arcade: appears only after the secret has been found, and pins the Arcade page to the menu. */
export default function ArcadeCard() {
  const unlocked = useArcadeUnlocked()
  const pinned = useArcadePinned()
  if (!unlocked) return null
  return (
    <div className="glass rounded-3xl p-5">
      <h2 className="mb-1 text-base font-bold">Arcade</h2>
      <p className="mb-2 text-xs text-[var(--text-dim)]">You found the secret. Keep the little games one click away.</p>
      <label className="flex cursor-pointer items-start gap-3 py-2">
        <input type="checkbox" className="mt-0.5 accent-[var(--accent)]" checked={pinned} onChange={(e) => setArcadePinned(e.target.checked)} />
        <span>
          <span className="text-sm font-medium">Show Arcade in the menu</span>
          <span className="block text-[11px] text-[var(--text-dim)]">Adds a permanent Arcade page next to Settings. You can still reach it any time by clicking the OPNduck name.</span>
        </span>
      </label>
    </div>
  )
}
// --- end: settings/arcade ---
