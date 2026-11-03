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
import FeatureCard from '../../components/FeatureCard'
import GlassSelect from '../../components/GlassSelect'
import ProgressBar from '../../components/ProgressBar'
import Tag from '../../components/Tag'
import TaskLogs from '../../components/TaskLogs'
import { host, type GradeLook, type GradeValues, type MediaInfo } from '../../host'
import { getDownloadDirOverride } from '../../lib/downloadPrefs'
import { formatBytes } from '../../lib/formatBytes'
import { useSubmittedIds } from '../../lib/submittedTasks'
import { useTasks } from '../../lib/useTasks'
import type { FeatureDefinition } from '../registry'
import { formatTime } from '../trim/time'

const EXTENSIONS = ['mp4', 'mkv', 'mov', 'webm', 'avi', 'm4v']
const IMAGES = ['png', 'jpg', 'jpeg', 'webp', 'bmp']
const NEUTRAL: GradeValues = { exposure: 0, contrast: 1, saturation: 1, temperature: 0, tint: 0, blackPoint: 0, whitePoint: 1 }
const SLIDERS: { key: keyof GradeValues; label: string; min: number; max: number; step: number }[] = [
  { key: 'temperature', label: 'Warmth', min: -1, max: 1, step: 0.05 },
  { key: 'tint', label: 'Tint (green to magenta)', min: -1, max: 1, step: 0.05 },
  { key: 'exposure', label: 'Exposure (stops)', min: -2, max: 2, step: 0.1 },
  { key: 'contrast', label: 'Contrast', min: 0.5, max: 1.6, step: 0.02 },
  { key: 'saturation', label: 'Saturation', min: 0, max: 2, step: 0.02 },
]
const SAVED_KEY = 'opnduck.grade.saved'

interface Saved {
  name: string
  values: GradeValues
  look: string
  intensity: number
}

const basename = (p: string) => p.split(/[/\\]/).pop() ?? p
const clean = (err: unknown) => (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']*': (Error: )?/, '')
const loadSaved = (): Saved[] => {
  try {
    const v = JSON.parse(localStorage.getItem(SAVED_KEY) ?? '[]')
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

/** The original frame with the graded one revealed from the left by a slider. */
function BeforeAfter({ before, after }: { before: string; after: string }) {
  const [pos, setPos] = useState(50)
  return (
    <div className="flex flex-col gap-2">
      <div className="relative overflow-hidden rounded-xl">
        <img src={before} alt="Before" className="block w-full" />
        <img src={after} alt="After" className="absolute inset-0 block w-full" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }} />
        <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-[var(--accent)]" style={{ left: `${pos}%` }} />
        <span className="absolute left-2 top-2 rounded bg-black/60 px-1.5 text-[10px]">After</span>
        <span className="absolute right-2 top-2 rounded bg-black/60 px-1.5 text-[10px]">Before</span>
      </div>
      <input type="range" aria-label="Before and after" className="w-full accent-[var(--accent)]" min={0} max={100} value={pos} onChange={(e) => setPos(Number(e.target.value))} />
    </div>
  )
}

// @category: grade/grade-card
/** Colour grade: fix the picture automatically, pick a look, match another picture, or move the sliders, with a before/after preview. */
export default function GradeCard({ feature }: { feature: FeatureDefinition }) {
  const [file, setFile] = useState<string | null>(null)
  const [info, setInfo] = useState<MediaInfo | null>(null)
  const [values, setValues] = useState<GradeValues>(NEUTRAL)
  const [looks, setLooks] = useState<GradeLook[]>([])
  const [look, setLook] = useState('')
  const [intensity, setIntensity] = useState(1)
  const [why, setWhy] = useState<{ setting: string; because: string }[]>([])
  const [preview, setPreview] = useState<{ before: string; after: string } | null>(null)
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState('')
  const [saved, setSaved] = useState<Saved[]>(loadSaved)
  const [naming, setNaming] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submittedIds, setSubmittedIds] = useSubmittedIds('grade')
  const tasks = useTasks()
  const submitted = tasks.filter((t) => submittedIds.includes(t.id))
  const running = submitted.some((t) => t.status === 'queued' || t.status === 'running')
  const gen = useRef(0)

  const refreshLooks = useCallback(() => void host.grade.looks().then(setLooks), [])
  useEffect(refreshLooks, [refreshLooks])

  useEffect(() => {
    if (!file) return
    let alive = true
    void host.probeMedia(file).then((i) => {
      if (!alive) return
      setInfo(i)
      setError(i?.hasVideo ? null : "Couldn't read a video in that file.")
    })
    return () => {
      alive = false
    }
  }, [file])

  // The preview follows the sliders, a moment after they stop moving.
  useEffect(() => {
    if (!file || !info?.hasVideo) return
    const mine = ++gen.current
    const t = setTimeout(() => {
      void host.grade
        .preview({ inputPath: file, values, look: look || undefined, intensity, width: 640 })
        .then((p) => mine === gen.current && p.before && p.after && setPreview({ before: p.before, after: p.after }))
        .catch(() => {})
    }, 350)
    return () => clearTimeout(t)
  }, [file, info, values, look, intensity])

  function choose(p: string) {
    setFile(p)
    setPreview(null)
    setValues(NEUTRAL)
    setLook('')
    setWhy([])
  }
  async function pick() {
    const p = await host.pickFile({ extensions: EXTENSIONS })
    if (p) choose(p)
  }

  async function guard(name: string, fn: () => Promise<void>) {
    setBusy(name)
    setError(null)
    try {
      await fn()
    } catch (err) {
      setError(clean(err))
    } finally {
      setBusy('')
    }
  }

  const auto = () =>
    guard('auto', async () => {
      const r = await host.grade.auto(file!)
      setValues(r.values)
      setWhy(r.why)
    })
  const match = () =>
    guard('match', async () => {
      const ref = await host.pickFile({ extensions: [...IMAGES, ...EXTENSIONS] })
      if (!ref) return
      const id = await host.grade.match(file!, ref)
      setLooks(await host.grade.looks())
      setLooks((l) => (l.some((x) => x.id === id) ? l : [...l, { id, label: `Matched to ${basename(ref)}` }]))
      setLook(id)
      setIntensity(1)
    })
  const importLut = () =>
    guard('lut', async () => {
      const f = await host.pickFile({ extensions: ['cube'] })
      if (!f) return
      const id = await host.grade.importLut(f)
      refreshLooks()
      setLook(id)
    })
  const askAi = () =>
    guard('ai', async () => {
      const r = await host.grade.aiLook({ inputPath: file!, prompt })
      setValues({ ...NEUTRAL, exposure: r.exposure, contrast: r.contrast, saturation: r.saturation, temperature: r.temperature, tint: r.tint })
      setLook(r.look)
      setIntensity(r.intensity)
      setWhy([{ setting: 'the assistant', because: r.why || 'chose these values' }])
    })
  const run = (useAuto: boolean) =>
    guard('run', async () => {
      const id = await host.tasks.startGrade({ inputPath: file!, auto: useAuto, look: look || undefined, intensity, values, destination: getDownloadDirOverride() ?? undefined })
      setSubmittedIds([id])
    })

  function saveLook(name: string) {
    if (!name.trim()) return
    const next = [...saved.filter((s) => s.name !== name.trim()), { name: name.trim(), values, look, intensity }].slice(-20)
    setSaved(next)
    setNaming(null)
    try {
      localStorage.setItem(SAVED_KEY, JSON.stringify(next))
    } catch {
      /* not remembered */
    }
  }

  const changed = look !== '' || (Object.keys(NEUTRAL) as (keyof GradeValues)[]).some((k) => values[k] !== NEUTRAL[k])
  return (
    <FeatureCard feature={feature} onDropFiles={running ? undefined : (paths) => paths[0] && choose(paths[0])} dropExtensions={EXTENSIONS}>
      <button type="button" className="glass-btn" onClick={pick} disabled={running}>
        {file ? 'Choose another video…' : 'Choose a video…'}
      </button>
      {file && (
        <span className="truncate text-xs text-[var(--text-dim)]">
          {basename(file)}
          {info ? ` — ${formatTime(info.duration)}${info.width ? `, ${info.width}×${info.height}` : ''}` : ''}
        </span>
      )}
      {preview && <BeforeAfter before={preview.before} after={preview.after} />}
      {file && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className="glass-btn px-3 py-1.5 text-xs" onClick={() => void auto()} disabled={running || !!busy}>
            {busy === 'auto' ? 'Measuring…' : 'Auto fix'}
          </button>
          <button type="button" className="glass-btn px-3 py-1.5 text-xs" onClick={() => void match()} disabled={running || !!busy}>
            {busy === 'match' ? 'Matching…' : 'Match a picture…'}
          </button>
          <button type="button" className="glass-btn px-3 py-1.5 text-xs" onClick={() => (setValues(NEUTRAL), setLook(''), setWhy([]))} disabled={running || !changed}>
            Reset
          </button>
        </div>
      )}
      {why.length > 0 && (
        <ul className="list-disc pl-5 text-[11px] text-[var(--text-dim)]">
          {why.map((w, i) => (
            <li key={i}>
              <strong>{w.setting}:</strong> {w.because}
            </li>
          ))}
        </ul>
      )}
      <div>
        <span className="mb-1 block text-xs font-medium text-[var(--text-dim)]">Look</span>
        <GlassSelect id="grade-look" options={[{ value: '', label: 'None' }, ...looks.map((l) => ({ value: l.id, label: l.label }))]} value={look} onChange={setLook} />
        {look && (
          <div className="mt-2">
            <label htmlFor="grade-int" className="mb-1 flex justify-between text-xs text-[var(--text-dim)]">
              <span>Strength</span>
              <span>{Math.round(intensity * 100)}%</span>
            </label>
            <input id="grade-int" type="range" className="w-full accent-[var(--accent)]" min={0} max={1} step={0.05} value={intensity} onChange={(e) => setIntensity(Number(e.target.value))} />
          </div>
        )}
        <button type="button" className="mt-2 text-[11px] text-[var(--accent)] underline" onClick={() => void importLut()}>
          Import your own .cube file…
        </button>
      </div>
      <div className="flex flex-col gap-2">
        {SLIDERS.map((s) => (
          <div key={s.key}>
            <label htmlFor={`grade-${s.key}`} className="mb-0.5 flex justify-between text-xs text-[var(--text-dim)]">
              <span>{s.label}</span>
              <span>{values[s.key]}</span>
            </label>
            <input id={`grade-${s.key}`} type="range" className="w-full accent-[var(--accent)]" min={s.min} max={s.max} step={s.step} value={values[s.key]} onChange={(e) => setValues({ ...values, [s.key]: Number(e.target.value) })} />
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-2 border-t border-[var(--glass-border)] pt-2">
        <span className="text-xs font-medium text-[var(--text-dim)]">Ask the assistant for a look</span>
        <div className="flex gap-2">
          <input className="glass-input min-w-0 flex-1" aria-label="Describe the look" placeholder="for example: a warm 70s film" value={prompt} onChange={(e) => setPrompt(e.target.value)} />
          <button type="button" className="glass-btn px-3 py-1.5 text-xs" onClick={() => void askAi()} disabled={!file || !!busy || running}>
            {busy === 'ai' ? 'Thinking…' : 'Suggest'}
          </button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {naming === null ? (
          <button type="button" className="glass-btn px-3 py-1.5 text-xs" onClick={() => setNaming('')} disabled={!changed}>
            Save this look
          </button>
        ) : (
          <form className="flex gap-1" onSubmit={(e) => (e.preventDefault(), saveLook(naming))}>
            <input className="glass-input w-32" aria-label="Name of the look" autoFocus placeholder="Name" value={naming} onChange={(e) => setNaming(e.target.value)} />
            <button type="submit" className="glass-btn px-2 py-1 text-xs">
              Save
            </button>
          </form>
        )}
        {saved.length > 0 && (
          <div className="w-44">
            <GlassSelect
              id="grade-saved"
              options={[{ value: '', label: 'Saved looks…' }, ...saved.map((s) => ({ value: s.name, label: s.name }))]}
              value=""
              onChange={(name) => {
                const s = saved.find((x) => x.name === name)
                if (!s) return
                setValues(s.values)
                setLook(s.look)
                setIntensity(s.intensity)
              }}
            />
          </div>
        )}
      </div>
      {error && <span className="text-xs text-red-400">{error}</span>}
      {submitted.map((t) => (
        <div key={t.id} className="flex flex-col gap-1">
          <ProgressBar value={t.progress} status={t.status} />
          <TaskLogs taskId={t.id} />
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-xs text-[var(--text-dim)]">{t.status === 'error' ? t.error : t.label}</span>
            {t.status === 'done' && (
              <>
                {t.quality && <Tag>{t.quality}</Tag>}
                {formatBytes(t.sizeBytes) && <Tag>{formatBytes(t.sizeBytes)}</Tag>}
              </>
            )}
          </div>
        </div>
      ))}
      <button type="button" className="glass-btn" onClick={() => void run(false)} disabled={!file || !info?.hasVideo || running || !changed}>
        Apply the grade
      </button>
    </FeatureCard>
  )
}
// --- end: grade/grade-card ---
