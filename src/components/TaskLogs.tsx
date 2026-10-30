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

import { useEffect, useRef, useState } from 'react'
import { host } from '../host'

// @category: app/task-logs
/** "Show live logs": a collapsible tail of what the job's tools are printing right now. */
export default function TaskLogs({ taskId }: { taskId: string }) {
  const [open, setOpen] = useState(false)
  const [lines, setLines] = useState<string[] | null>(null)
  const box = useRef<HTMLPreElement>(null)

  useEffect(() => {
    if (!open) return
    let alive = true
    host.tasks.logs(taskId).then((l) => alive && setLines((cur) => cur ?? l))
    const off = host.tasks.watchLog(taskId, ({ lines: more, replaceLast }) => {
      setLines((cur) => {
        const base = cur ?? []
        const next = replaceLast ? [...base.slice(0, -1), ...more] : [...base, ...more]
        return next.slice(-400)
      })
    })
    return () => {
      alive = false
      off()
    }
  }, [open, taskId])

  // Keep the newest line in view unless the user scrolled up to read.
  useEffect(() => {
    const el = box.current
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 40) el.scrollTop = el.scrollHeight
  }, [lines])

  if (!host.isDesktop) return null
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        className="self-start text-[11px] text-[var(--text-faint)] underline-offset-2 hover:text-[var(--text)] hover:underline"
        onClick={() => {
          setOpen((o) => !o)
          setLines(null)
        }}
        aria-expanded={open}
      >
        {open ? 'Hide live logs' : 'Show live logs'}
      </button>
      {open && (
        <pre
          ref={box}
          className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-[var(--bg-solid)] p-2 font-mono text-[11px] leading-snug text-[var(--text-dim)]"
        >
          {lines === null ? 'Loading…' : lines.length ? lines.join('\n') : 'Nothing logged yet (jobs from an earlier launch keep no log).'}
        </pre>
      )}
    </div>
  )
}
// --- end: app/task-logs ---
