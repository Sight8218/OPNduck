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

import { useCallback, useEffect, useState } from 'react'
import { host } from '../host'

type Info = Record<string, Record<string, string | number | boolean>>
type Metric = { pid: number; type: string; cpu: number; memMB: number }
type LogLine = { t: number; level: string; text: string }

const row = 'flex flex-col gap-2 border-t border-[var(--glass-border)] pt-3'

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null)
  const copy = useCallback(async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(key)
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500)
    } catch {
      /* clipboard may be blocked */
    }
  }, [])
  return { copied, copy }
}

// @category: dev/dev-desktop-tools
/** The desktop half of Developer Tools: app/tool info, live process metrics, logs, tasks, and quick actions. */
export default function DevDesktopTools() {
  const dev = host.dev
  const { copied, copy } = useCopy()
  const [info, setInfo] = useState<Info | null>(null)
  const [metrics, setMetrics] = useState<Metric[]>([])
  const [logs, setLogs] = useState<LogLine[]>([])
  const [level, setLevel] = useState<'all' | 'warn' | 'error'>('all')
  const [tasksJson, setTasksJson] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const loadInfo = useCallback(() => void dev?.info().then(setInfo), [dev])
  const loadTasks = useCallback(() => void dev?.tasks().then((t) => setTasksJson(JSON.stringify(t, null, 2))), [dev])

  useEffect(() => {
    if (!dev) return
    loadInfo()
    const tick = () => {
      void dev.metrics().then(setMetrics)
      void dev.logs().then(setLogs)
    }
    tick()
    const t = setInterval(tick, 2000)
    return () => clearInterval(t)
  }, [dev, loadInfo])

  if (!dev) return null

  const flash = (text: string) => {
    setNote(text)
    setTimeout(() => setNote(null), 2500)
  }
  const btn = 'glass-btn px-3 py-1.5 text-xs'
  const shownLogs = logs.filter((l) => level === 'all' || (level === 'warn' ? l.level !== 'log' && l.level !== 'info' : l.level === 'error'))
  const totalMem = metrics.reduce((s, m) => s + m.memMB, 0)

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-4">
      <span className="text-sm font-semibold text-[var(--text)]">Desktop developer tools</span>

      <div className="flex flex-wrap gap-2">
        <button type="button" className={btn} onClick={() => void dev.toggleDevTools()}>Open DevTools</button>
        <button type="button" className={btn} onClick={() => void dev.reloadUI()}>Reload UI</button>
        <button type="button" className={btn} onClick={() => void dev.openUserData()}>Open data folder</button>
        <button type="button" className={btn} onClick={() => void dev.testNotification().then((ok) => flash(ok ? 'Notification sent' : 'Notifications not supported'))}>Test notification</button>
        <button type="button" className={btn} onClick={() => void dev.fakeJob(false).then(() => flash('Fake job started: see the Library'))}>Fake job</button>
        <button type="button" className={btn} onClick={() => void dev.fakeJob(true).then(() => flash('Failing fake job started'))}>Fake failing job</button>
        <button type="button" className={btn} onClick={() => void dev.diagnostics().then((d) => copy('diag', d))}>
          {copied === 'diag' ? 'Copied!' : 'Copy diagnostics (redacted)'}
        </button>
      </div>
      {note && <span className="text-xs text-[var(--text-dim)]">{note}</span>}

      <div className={row}>
        <div className="flex items-center justify-between">
          <span className="text-sm text-[var(--text)]">System &amp; tools</span>
          <button type="button" className={btn} onClick={loadInfo}>Refresh</button>
        </div>
        {info ? (
          <div className="grid grid-cols-1 gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
            {Object.entries(info).flatMap(([group, vals]) =>
              Object.entries(vals).map(([k, v]) => (
                <div key={`${group}.${k}`} className="flex justify-between gap-3">
                  <span className="text-[var(--text-dim)]">{group} · {k}</span>
                  <span className="truncate text-right font-mono text-[var(--text)]" title={String(v)}>{String(v)}</span>
                </div>
              )),
            )}
          </div>
        ) : (
          <span className="text-xs text-[var(--text-faint)]">Loading…</span>
        )}
      </div>

      <div className={row}>
        <div className="flex items-center justify-between">
          <span className="text-sm text-[var(--text)]">Processes</span>
          <span className="text-xs text-[var(--text-dim)]">{metrics.length} processes · {totalMem} MB total (updates every 2 s)</span>
        </div>
        <table className="w-full text-left font-mono text-[11px]">
          <tbody>
            {metrics.map((m) => (
              <tr key={m.pid} className="text-[var(--text-dim)]">
                <td className="py-0.5 pr-3 text-[var(--text)]">{m.type}</td>
                <td className="pr-3">pid {m.pid}</td>
                <td className="pr-3 text-right">{m.cpu}% cpu</td>
                <td className="text-right">{m.memMB} MB</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <details className={row}>
        <summary className="cursor-pointer text-sm text-[var(--text)]">App log ({shownLogs.length} lines)</summary>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {(['all', 'warn', 'error'] as const).map((l) => (
            <button key={l} type="button" className={`${btn} ${level === l ? 'opacity-100' : 'opacity-60'}`} onClick={() => setLevel(l)}>
              {l === 'all' ? 'All' : l === 'warn' ? 'Warnings+' : 'Errors'}
            </button>
          ))}
          <button type="button" className={btn} onClick={() => void copy('log', shownLogs.map((l) => `${new Date(l.t).toISOString()} ${l.level} ${l.text}`).join('\n'))}>
            {copied === 'log' ? 'Copied!' : 'Copy'}
          </button>
        </div>
        <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-[var(--bg-solid)] p-2 font-mono text-[11px] leading-snug text-[var(--text-dim)]">
          {shownLogs.length ? shownLogs.map((l) => `${new Date(l.t).toLocaleTimeString()} ${l.level.padEnd(5)} ${l.text}`).join('\n') : 'Nothing logged yet.'}
        </pre>
      </details>

      <details className={row} onToggle={(e) => (e.currentTarget as HTMLDetailsElement).open && loadTasks()}>
        <summary className="cursor-pointer text-sm text-[var(--text)]">Tasks inspector (raw job data)</summary>
        <div className="mt-2 flex gap-2">
          <button type="button" className={btn} onClick={loadTasks}>Refresh</button>
          <button type="button" className={btn} onClick={() => tasksJson && void copy('tasks', tasksJson)}>{copied === 'tasks' ? 'Copied!' : 'Copy'}</button>
        </div>
        <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-[var(--bg-solid)] p-2 font-mono text-[11px] leading-snug text-[var(--text-dim)]">
          {tasksJson ?? 'Loading…'}
        </pre>
      </details>
    </div>
  )
}
// --- end: dev/dev-desktop-tools ---
