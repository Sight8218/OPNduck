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
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Reorder } from 'framer-motion'
import { IconGripVertical, IconX } from '@tabler/icons-react'
import { host, type Recipe, type RecipeInput, type RecipeTool } from '../host'
import { TITLES, typesAlong, type DataType } from '../features/recipes/chain'
import Tag from '../components/Tag'

interface DraftStep {
  key: string
  tool: string
  args: Record<string, unknown>
}
interface Draft {
  id?: string
  name: string
  input: RecipeInput
  steps: DraftStep[]
  builtIn?: boolean
}

const INPUT_LABEL: Record<RecipeInput, string> = { url: 'a link', video: 'a video file', audio: 'an audio file', image: 'an image file' }
const EXT: Record<string, string[]> = {
  video: ['mp4', 'mkv', 'mov', 'webm', 'avi', 'm4v'],
  audio: ['mp3', 'flac', 'wav', 'ogg', 'm4a', 'opus'],
  image: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'avif'],
}

const clean = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']*': (Error: )?/, '')
const fresh = (r: Recipe): Draft => ({ id: r.id, name: r.name, input: r.input, builtIn: r.builtIn, steps: r.steps.map((s) => ({ key: crypto.randomUUID(), tool: s.tool, args: { ...s.args } })) })

export default function Recipes() {
  const recipes = host.recipes
  const [list, setList] = useState<Recipe[]>([])
  const [tools, setTools] = useState<Record<string, RecipeTool>>({})
  const [draft, setDraft] = useState<Draft | null>(null)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  const refresh = useCallback(async () => {
    const [l, t] = await Promise.all([recipes.list(), recipes.tools()])
    setList(l)
    setTools(Object.fromEntries(t.map((x) => [x.name, x])))
  }, [recipes])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const edit = (change: (d: Draft) => Draft) => {
    setDraft((d) => (d ? change(d) : d))
    setDirty(true)
    setNotice('')
  }

  const types = useMemo(() => (draft ? typesAlong(draft.input as DataType, draft.steps) : []), [draft])
  const endType = types[types.length - 1]
  const addable = Object.values(tools).filter((t) => t.accepts.includes(endType))

  function addStep(name: string) {
    const t = tools[name]
    if (!t) return
    const args: Record<string, unknown> = { ...t.defaults }
    // A required setting with no default starts at the first choice, so the new step is valid straight away.
    for (const k of t.required) {
      const spec = t.properties[k]
      if (args[k] === undefined && spec.enum?.length) args[k] = spec.enum[0]
      else if (args[k] === undefined && [].concat(spec.type as never).includes('number' as never)) args[k] = spec.minimum ?? 0
    }
    edit((d) => ({ ...d, steps: [...d.steps, { key: crypto.randomUUID(), tool: name, args }] }))
  }

  async function save() {
    if (!draft) return
    setError('')
    try {
      const saved = await recipes.save({ id: draft.id, name: draft.name, input: draft.input, steps: draft.steps.map((s) => ({ tool: s.tool, args: s.args })) })
      await refresh()
      setDraft(fresh(saved))
      setDirty(false)
      setNotice('Saved.')
    } catch (e) {
      setError(clean(e))
    }
  }

  async function duplicate() {
    if (!draft?.id) return
    try {
      const copy = await recipes.duplicate(draft.id)
      await refresh()
      setDraft(fresh(copy))
      setDirty(false)
    } catch (e) {
      setError(clean(e))
    }
  }

  async function remove() {
    if (!draft?.id) return
    await recipes.remove(draft.id)
    setDraft(null)
    setConfirmDelete(false)
    await refresh()
  }

  if (!host.isDesktop) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <h1 className="mb-1 text-2xl font-extrabold sm:text-3xl">Recipes</h1>
        <div className="glass mt-4 rounded-3xl p-8 text-center text-sm text-[var(--text-dim)]">Recipes need the desktop app.</div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <h1 className="mb-1 text-2xl font-extrabold sm:text-3xl">Recipes</h1>
      <p className="mb-4 text-sm text-[var(--text-dim)]">Chain tools into one saved flow: each step's result goes to the next. The steps show up as one group in the Library.</p>

      <div className="grid gap-4 md:grid-cols-[260px_1fr]">
        <div className="flex flex-col gap-2">
          <button
            type="button"
            className="glass-btn"
            onClick={() => {
              setDraft({ name: 'My recipe', input: 'video', steps: [] })
              setDirty(true)
              setError('')
              setNotice('')
            }}
          >
            New recipe
          </button>
          {list.map((r) => (
            <button
              key={r.id}
              type="button"
              aria-pressed={draft?.id === r.id}
              onClick={() => {
                setDraft(fresh(r))
                setDirty(false)
                setError('')
                setNotice('')
                setConfirmDelete(false)
              }}
              className={`glass rounded-2xl p-3 text-left transition-colors ${draft?.id === r.id ? 'border-[var(--accent)]' : ''}`}
            >
              <span className="flex items-center gap-2 text-sm font-bold">
                {r.name}
                {r.builtIn && <Tag>Built in</Tag>}
              </span>
              <span className="block text-[11px] text-[var(--text-dim)]">
                From {INPUT_LABEL[r.input]} · {r.steps.length} step{r.steps.length === 1 ? '' : 's'}
              </span>
            </button>
          ))}
        </div>

        {!draft ? (
          <div className="glass rounded-3xl p-8 text-center text-sm text-[var(--text-dim)]">Pick a recipe on the left, or make a new one.</div>
        ) : (
          <div className="glass flex flex-col gap-3 rounded-3xl p-5">
            <div className="grid gap-3 sm:grid-cols-[1fr_200px]">
              <div>
                <label htmlFor="recipe-name" className="mb-1 block text-xs font-medium text-[var(--text-dim)]">Name</label>
                <input id="recipe-name" className="glass-input" value={draft.name} disabled={draft.builtIn} maxLength={60} onChange={(e) => edit((d) => ({ ...d, name: e.target.value }))} />
              </div>
              <div>
                <label htmlFor="recipe-input" className="mb-1 block text-xs font-medium text-[var(--text-dim)]">Starts from</label>
                <select id="recipe-input" className="glass-input" value={draft.input} disabled={draft.builtIn} onChange={(e) => edit((d) => ({ ...d, input: e.target.value as RecipeInput, steps: [] }))}>
                  {(Object.keys(INPUT_LABEL) as RecipeInput[]).map((k) => (
                    <option key={k} value={k}>
                      {INPUT_LABEL[k]}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {draft.builtIn && <span className="text-[11px] text-[var(--text-faint)]">Built-in recipes can't be changed. Duplicate it to make your own version.</span>}

            <Reorder.Group axis="y" values={draft.steps} onReorder={(steps) => !draft.builtIn && edit((d) => ({ ...d, steps }))} className="flex flex-col gap-2">
              {draft.steps.map((step, i) => {
                const t = tools[step.tool]
                const ok = t?.accepts.includes(types[i])
                return (
                  <Reorder.Item key={step.key} value={step} dragListener={!draft.builtIn} className="rounded-2xl border border-[var(--glass-border)] bg-[var(--input-bg)] p-3">
                    <div className="mb-2 flex items-center gap-2">
                      {!draft.builtIn && <IconGripVertical size={16} className="cursor-grab text-[var(--text-faint)]" aria-hidden="true" />}
                      <span className="text-sm font-bold">
                        {i + 1}. {TITLES[step.tool] ?? step.tool}
                      </span>
                      <span className="text-[11px] text-[var(--text-faint)]">
                        {types[i]} → {types[i + 1]}
                      </span>
                      {!ok && <span className="text-[11px] text-red-400">can't take {types[i]} here</span>}
                      {!draft.builtIn && (
                        <button type="button" aria-label={`Remove step ${i + 1}`} className="ml-auto text-[var(--text-faint)] hover:text-[var(--text)]" onClick={() => edit((d) => ({ ...d, steps: d.steps.filter((s) => s.key !== step.key) }))}>
                          <IconX size={14} aria-hidden="true" />
                        </button>
                      )}
                    </div>
                    {t && (
                      <div className="grid gap-2 sm:grid-cols-2">
                        {Object.entries(t.properties).map(([name, spec]) => (
                          <StepField key={name} name={name} spec={spec} required={t.required.includes(name)} value={step.args[name]} disabled={!!draft.builtIn} onChange={(v) => edit((d) => ({ ...d, steps: d.steps.map((s) => (s.key === step.key ? { ...s, args: Object.fromEntries(Object.entries({ ...s.args, [name]: v }).filter(([, x]) => x !== undefined && x !== '')) } : s)) }))} />
                        ))}
                      </div>
                    )}
                  </Reorder.Item>
                )
              })}
            </Reorder.Group>

            {!draft.builtIn && (
              <div>
                <label htmlFor="recipe-add" className="mb-1 block text-xs font-medium text-[var(--text-dim)]">Add a step (after the {endType} so far)</label>
                <select id="recipe-add" className="glass-input" value="" onChange={(e) => e.target.value && addStep(e.target.value)}>
                  <option value="">Choose a tool…</option>
                  {addable.map((t) => (
                    <option key={t.name} value={t.name}>
                      {TITLES[t.name] ?? t.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {error && <span className="text-xs text-red-400">{error}</span>}
            {notice && <span className="text-xs text-[var(--text-dim)]">{notice}</span>}
            <div className="flex flex-wrap gap-2">
              {!draft.builtIn && (
                <button type="button" className="glass-btn" onClick={() => void save()} disabled={!dirty || !draft.name.trim() || draft.steps.length === 0}>
                  Save
                </button>
              )}
              {draft.id && (
                <button type="button" className="glass-btn" onClick={() => void duplicate()}>
                  Duplicate
                </button>
              )}
              {draft.id && !draft.builtIn && !confirmDelete && (
                <button type="button" className="glass-btn" onClick={() => setConfirmDelete(true)}>
                  Delete
                </button>
              )}
              {confirmDelete && (
                <>
                  <button type="button" className="glass-btn text-red-400" onClick={() => void remove()}>
                    Delete for good
                  </button>
                  <button type="button" className="glass-btn" onClick={() => setConfirmDelete(false)}>
                    Keep
                  </button>
                </>
              )}
            </div>

            {draft.id && !dirty && <RunPanel recipe={draft} onMessage={(m, e) => (setNotice(m), setError(e))} />}
            {draft.id && dirty && !draft.builtIn && <span className="text-[11px] text-[var(--text-faint)]">Save your changes to run it.</span>}
          </div>
        )}
      </div>
    </div>
  )
}

type Spec = RecipeTool['properties'][string]

function StepField({ name, spec, required, value, disabled, onChange }: { name: string; spec: Spec; required: boolean; value: unknown; disabled: boolean; onChange: (v: unknown) => void }) {
  const types = ([] as string[]).concat(spec.type ?? [])
  const id = `step-${name}-${Math.random().toString(36).slice(2, 7)}`
  const nice: Record<string, string> = { targetMB: 'Target size (MB)', minConfidence: 'Needs to be this sure', inputPath: 'File' }
  const label = `${nice[name] ?? name.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())}${required ? ' *' : ''}`
  if (spec.enum) {
    return (
      <div>
        <label htmlFor={id} className="mb-1 block text-xs font-medium text-[var(--text-dim)]">{label}</label>
        <select id={id} className="glass-input" disabled={disabled} value={String(value ?? '')} onChange={(e) => onChange(spec.enum!.find((o) => String(o) === e.target.value) ?? undefined)}>
          {!required && <option value="">Default</option>}
          {spec.enum.map((o) => (
            <option key={String(o)} value={String(o)}>
              {String(o)}
            </option>
          ))}
        </select>
      </div>
    )
  }
  if (types.includes('boolean')) {
    return (
      <label className="flex cursor-pointer items-center gap-2 py-1 text-xs text-[var(--text-dim)]">
        <input type="checkbox" className="accent-[var(--accent)]" disabled={disabled} checked={value === true} onChange={(e) => onChange(e.target.checked)} />
        {label}
      </label>
    )
  }
  if (types.includes('number') || types.includes('integer')) {
    return (
      <div>
        <label htmlFor={id} className="mb-1 block text-xs font-medium text-[var(--text-dim)]">{label}</label>
        <input id={id} className="glass-input" type="number" disabled={disabled} min={spec.minimum} max={spec.maximum} step={types.includes('integer') ? 1 : 'any'} value={value == null ? '' : String(value)} onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))} />
      </div>
    )
  }
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-[var(--text-dim)]">{label}</label>
      <input id={id} className="glass-input" disabled={disabled} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />
    </div>
  )
}

function RunPanel({ recipe, onMessage }: { recipe: Draft; onMessage: (notice: string, error: string) => void }) {
  const [link, setLink] = useState('')
  const [keep, setKeep] = useState(false)
  const [busy, setBusy] = useState(false)

  async function go(inputs: string[]) {
    setBusy(true)
    let started = 0
    let failed = ''
    for (const input of inputs) {
      try {
        await host.recipes.run(recipe.id!, input, { keepIntermediate: keep })
        started++
      } catch (e) {
        failed = clean(e)
        break
      }
    }
    setBusy(false)
    onMessage(started ? `Started ${started} run${started === 1 ? '' : 's'}. Watch them in the Library.` : '', failed)
  }

  return (
    <div className="flex flex-col gap-2 border-t border-[var(--glass-border)] pt-3">
      <span className="text-sm font-bold">Run it on {INPUT_LABEL[recipe.input]}</span>
      {recipe.input === 'url' ? (
        <div className="flex flex-wrap gap-2">
          <input aria-label="Link" className="glass-input min-w-0 flex-1" placeholder="https://…" value={link} onChange={(e) => setLink(e.target.value)} />
          <button type="button" className="glass-btn" disabled={busy || !link.trim()} onClick={() => void go([link.trim()])}>
            Run
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="glass-btn"
            disabled={busy}
            onClick={async () => {
              const files = await host.pickFiles({ extensions: EXT[recipe.input] })
              if (files?.length) await go(files)
            }}
          >
            Choose files…
          </button>
          <button
            type="button"
            className="glass-btn"
            disabled={busy}
            onClick={async () => {
              const folder = await host.pickFolder()
              if (!folder) return
              const files = await host.recipes.filesIn(folder, recipe.input)
              if (files.length) await go(files)
              else onMessage('', 'No matching files in that folder.')
            }}
          >
            Choose a folder…
          </button>
        </div>
      )}
      <label className="flex cursor-pointer items-center gap-2 text-xs text-[var(--text-dim)]">
        <input type="checkbox" className="accent-[var(--accent)]" checked={keep} onChange={(e) => setKeep(e.target.checked)} />
        Keep the files the middle steps make
      </label>
    </div>
  )
}
