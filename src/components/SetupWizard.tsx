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

import { useCallback, useEffect, useRef, useState } from 'react'
import { host, type PythonTool, type ToolStatus } from '../host'
import { closeSetup, openSetup, setupNeverShown, useSetupOpen } from '../lib/setupStore'

type Step = 'ytdlp' | PythonTool
type RunState = 'waiting' | 'installing' | 'done' | 'failed'

interface Row {
  id: string
  title: string
  blurb: string
  size: string
  step: Step
  installed: boolean
  /** Why it can't be chosen on this machine. */
  blocked?: string
}

interface SystemRow {
  title: string
  status: ToolStatus
}

const empty = (): ToolStatus => ({ available: false, installHint: '' })

async function readStatus(): Promise<{ rows: Row[]; system: SystemRow[] }> {
  const [ytdlp, torch, demucs, whisper, ffmpeg, esrgan, rife, office] = await Promise.all([
    host.checkYtDlp().catch(empty),
    host.checkTorchEngine().catch(() => ({ available: false, nvidia: false })),
    host.checkDemucs().catch(empty),
    host.checkFasterWhisper().catch(empty),
    host.checkFfmpeg().catch(empty),
    host.checkRealesrgan().catch(empty),
    host.checkRife().catch(empty),
    host.checkLibreOffice().catch(empty),
  ])
  const gpuWhisper = !!whisper.nvidia
  const rows: Row[] = [
    {
      id: 'ytdlp',
      title: 'Downloader',
      blurb: 'yt-dlp, kept up to date by OPNduck.',
      size: 'about 3 MB',
      step: 'ytdlp',
      installed: ytdlp.available,
    },
    {
      id: 'torch',
      title: 'Fast video engine',
      blurb: 'PyTorch engine for much faster video upscaling.',
      size: 'about 5 GB',
      step: 'torch',
      installed: torch.available,
      blocked: torch.nvidia ? undefined : 'Needs an NVIDIA GPU',
    },
    {
      id: 'demucs',
      title: 'Audio AI',
      blurb: 'Remove vocals, isolate a voice, drop background music.',
      size: 'about 5 GB',
      step: 'demucs',
      installed: demucs.available,
    },
    {
      id: 'whisper',
      title: gpuWhisper ? 'Subtitles (GPU)' : 'Subtitles',
      blurb: 'faster-whisper, offline speech to subtitles.',
      size: gpuWhisper ? 'about 2.3 GB' : 'about 200 MB',
      step: gpuWhisper ? 'whisper-gpu' : 'whisper',
      installed: whisper.available && (!gpuWhisper || !!whisper.gpu),
    },
  ]
  const system: SystemRow[] = [
    { title: 'ffmpeg', status: ffmpeg },
    { title: 'Real-ESRGAN', status: esrgan },
    { title: 'RIFE', status: rife },
    { title: 'LibreOffice', status: office },
  ]
  return { rows, system }
}

/** First-run and Settings "choose what to install" window. Mount once at the app root. */
export default function SetupWizard() {
  const open = useSetupOpen()

  // First launch on the desktop app: show the wizard once.
  useEffect(() => {
    if (host.isDesktop && setupNeverShown()) openSetup()
  }, [])

  return open ? <SetupDialog /> : null
}

function SetupDialog() {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [system, setSystem] = useState<SystemRow[]>([])
  const [picked, setPicked] = useState<Record<string, boolean>>({})
  const [run, setRun] = useState<Record<string, RunState>>({})
  const [line, setLine] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cancelled = useRef(false)

  const refresh = useCallback(async () => {
    const s = await readStatus()
    setRows(s.rows)
    setSystem(s.system)
    return s.rows
  }, [])

  useEffect(() => {
    void refresh().then((r) =>
      setPicked(Object.fromEntries(r.filter((x) => !x.installed && !x.blocked && x.id !== 'torch' && x.id !== 'demucs').map((x) => [x.id, true]))),
    )
  }, [refresh])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) closeSetup()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy])

  const chosen = (rows ?? []).filter((r) => picked[r.id] && !r.installed && !r.blocked)

  async function install() {
    cancelled.current = false
    setBusy(true)
    setError(null)
    setRun(Object.fromEntries(chosen.map((r) => [r.id, 'waiting' as RunState])))
    for (const r of chosen) {
      if (cancelled.current) break
      setRun((s) => ({ ...s, [r.id]: 'installing' }))
      setLine('Starting…')
      const res = r.step === 'ytdlp' ? await host.installYtDlp() : await host.installTool(r.step, setLine)
      if (cancelled.current) {
        setRun((s) => ({ ...s, [r.id]: 'failed' }))
        break
      }
      setRun((s) => ({ ...s, [r.id]: res.ok ? 'done' : 'failed' }))
      if (!res.ok) setError(`${r.title}: ${res.error ?? 'the install failed.'}`)
    }
    setBusy(false)
    setLine('')
    void refresh()
  }

  async function cancel() {
    cancelled.current = true
    await host.cancelInstall()
  }

  const finished = !busy && Object.keys(run).length > 0
  const missingSystem = system.filter((s) => !s.status.available)

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 px-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Setup"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) closeSetup()
      }}
    >
      <div className="glass glass-strong pop-in flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl">
        <div className="border-b border-[var(--glass-border)] px-6 py-4">
          <h2 className="text-lg font-bold">Set up OPNduck</h2>
          <p className="text-xs text-[var(--text-dim)]">Choose what to install. You can open this again from Settings, System.</p>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {!rows ? (
            <p className="py-6 text-center text-sm text-[var(--text-dim)]">Checking what you already have…</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {rows.map((r) => {
                const state = run[r.id]
                const disabled = r.installed || !!r.blocked || busy
                return (
                  <li key={r.id}>
                    <label
                      className={`flex items-start gap-3 rounded-2xl border border-[var(--glass-border)] bg-[var(--input-bg)] px-4 py-3 ${
                        disabled ? 'opacity-80' : 'cursor-pointer hover:border-[var(--accent)]'
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="mt-1 h-4 w-4 shrink-0 accent-[var(--accent)]"
                        checked={r.installed || !!picked[r.id]}
                        disabled={disabled}
                        onChange={(e) => setPicked((p) => ({ ...p, [r.id]: e.target.checked }))}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-3">
                          <span className="text-sm font-bold">{r.title}</span>
                          <span className="shrink-0 text-xs text-[var(--text-dim)]">
                            {r.installed ? 'Installed' : r.blocked ?? r.size}
                          </span>
                        </span>
                        <span className="block text-xs text-[var(--text-dim)]">{r.blurb}</span>
                        {state === 'installing' && <span className="mt-1 block truncate text-xs text-[var(--accent)]">{line}</span>}
                        {state === 'waiting' && <span className="mt-1 block text-xs text-[var(--text-dim)]">Waiting…</span>}
                        {state === 'done' && <span className="mt-1 block text-xs text-[var(--accent)]">Installed</span>}
                        {state === 'failed' && <span className="mt-1 block text-xs text-red-400">Not installed</span>}
                      </span>
                    </label>
                  </li>
                )
              })}
            </ul>
          )}

          {missingSystem.length > 0 && (
            <div className="mt-5">
              <h3 className="text-sm font-bold">Install from your system</h3>
              <p className="mb-2 text-xs text-[var(--text-dim)]">These come from your package manager. Run the command, then reopen this window.</p>
              <ul className="flex flex-col gap-2">
                {missingSystem.map((s) => (
                  <li key={s.title} className="rounded-2xl border border-[var(--glass-border)] bg-[var(--input-bg)] px-4 py-2">
                    <div className="text-sm font-bold">{s.title}</div>
                    {s.status.installHint && (
                      <code className="block break-all text-xs text-[var(--text-dim)] select-text">{s.status.installHint}</code>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {error && <p className="mt-4 text-xs text-red-400">{error}</p>}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-[var(--glass-border)] px-6 py-3">
          <span className="text-xs text-[var(--text-dim)]">
            {busy ? 'Installing. Large downloads can take a while.' : chosen.length > 0 ? `${chosen.length} selected` : 'Nothing selected'}
          </span>
          <div className="flex gap-2">
            {busy ? (
              <button type="button" className="glass-btn px-4 py-2 text-sm" onClick={cancel}>
                Cancel
              </button>
            ) : (
              <>
                <button type="button" className="px-4 py-2 text-sm text-[var(--text-dim)] hover:text-[var(--text)]" onClick={closeSetup}>
                  {finished ? 'Close' : 'Skip'}
                </button>
                <button type="button" className="glass-btn px-4 py-2 text-sm font-bold" disabled={chosen.length === 0} onClick={install}>
                  Install selected
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
