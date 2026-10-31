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

import { host } from '../host'
import { openSetup } from '../lib/setupStore'

/** Settings, System: reopen the setup window. */
export default function SetupCard() {
  if (!host.isDesktop) return null
  return (
    <div className="glass rounded-3xl p-5">
      <h2 className="mb-1 text-base font-bold">Setup</h2>
      <p className="mb-3 text-xs text-[var(--text-dim)]">Choose which tools and AI engines to install, and see what you already have.</p>
      <button type="button" className="glass-btn px-4 py-2 text-sm" onClick={openSetup}>
        Open setup
      </button>
    </div>
  )
}
