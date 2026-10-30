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
import { subscribeNotices } from '../lib/notice'

// @category: app/notices
/** Bottom-center toast for lib/notice messages; each one clears itself after 8 s. */
export default function NoticeHost() {
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => subscribeNotices(setMessage), [])
  useEffect(() => {
    if (!message) return
    const t = setTimeout(() => setMessage(null), 8000)
    return () => clearTimeout(t)
  }, [message])

  if (!message) return null
  return (
    <div role="status" className="glass fixed bottom-4 left-1/2 z-50 flex max-w-md -translate-x-1/2 items-center gap-3 rounded-xl px-4 py-2 text-sm">
      <span>{message}</span>
      <button type="button" className="text-[var(--text-faint)] hover:text-[var(--text)]" onClick={() => setMessage(null)} aria-label="Dismiss">
        ×
      </button>
    </div>
  )
}
// --- end: app/notices ---
