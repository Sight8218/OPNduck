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
import { host, type AiModel, type AiSettings, type AiState, type LocalAiStatus } from '../host'
import ProgressBar from './ProgressBar'
import { formatBytes } from '../lib/formatBytes'
import GlassSelect from './GlassSelect'

const PROVIDERS = [
  { value: 'off', label: 'Off' },
  { value: 'local', label: "On this computer: OPNduck's own model" },
  { value: 'ollama', label: 'Ollama (on this computer)' },
  { value: 'lmstudio', label: 'LM Studio (on this computer)' },
  { value: 'machine', label: 'Another computer' },
  { value: 'cloud', label: 'Cloud API (your own key)' },
]
const EFFORT = [
  { value: 'low', label: 'Low: short answers, no thinking' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High: thinks longer' },
]
const REASONING = [
  { value: 'auto', label: 'Automatic (from effort)' },
  { value: 'on', label: 'Always' },
  { value: 'off', label: 'Never' },
]

const CONTEXTS = [4096, 8192, 16384, 32768].map((n) => ({ value: String(n), label: `${n / 1024}k` }))
const IDLE = [0, 5, 15, 30, 60].map((n) => ({ value: String(n), label: n === 0 ? 'Never' : `${n} minutes` }))
const clean = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']*': (Error: )?/, '')

// @category: settings/ai
/** Settings > AI: which model answers, with your own keys, and how it behaves. Nothing is sent anywhere until you choose a provider. */
export default function AiCard() {
  const [ai, setAi] = useState<AiSettings | null>(null)
  const [state, setState] = useState<AiState | null>(null)
  const [models, setModels] = useState<AiModel[]>([])
  const [keyText, setKeyText] = useState('')
  const [token, setToken] = useState('')
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [local, setLocal] = useState<LocalAiStatus | null>(null)
  const [usage, setUsage] = useState<Record<string, { input: number; output: number; answers: number }>>({})

  const refresh = useCallback(async () => {
    setState(await host.ai.state())
  }, [])
  useEffect(() => {
    void host.settings?.get().then((s) => setAi(s.ai))
    void refresh()
    void host.ai.local.status().then(setLocal)
    void host.ai.usage().then(setUsage)
    return host.ai.local.onChange(setLocal)
  }, [refresh])

  async function save(patch: Partial<AiSettings>) {
    setNote(null)
    try {
      const next = await host.settings!.set({ ai: patch })
      setAi(next.ai)
    } catch (e) {
      setNote({ ok: false, text: clean(e) })
    }
  }

  async function test() {
    setBusy(true)
    setNote(null)
    const r = await host.ai.test()
    setBusy(false)
    if (r.ok) {
      setModels(r.models)
      setNote({ ok: true, text: `Connected. ${r.models.length} model${r.models.length === 1 ? '' : 's'} available.` })
    } else setNote({ ok: false, text: r.error })
  }

  if (!ai || !state) return null
  const run = (fn: () => Promise<unknown>) => void fn().catch((e) => setNote({ ok: false, text: clean(e) }))
  const model = local?.catalog[ai.localModel]
  const ready = !!local?.runtime && !!local.models[ai.localModel]
  const detected = ai.provider === 'ollama' || ai.provider === 'lmstudio' ? state.detected[ai.provider] : null
  const choices = models.length ? models : (detected?.models ?? [])
  const keyId = ai.provider === 'machine' ? 'machine' : ai.cloud
  const hasKey = state.keys.includes(keyId)
  const cloudLabel = state.cloud[ai.cloud] ?? ai.cloud

  return (
    <div className="glass rounded-3xl p-5">
      <h2 className="mb-1 text-base font-bold">AI</h2>
      <p className="mb-3 text-xs text-[var(--text-dim)]">
        Pick the model that answers in OPNduck. With a model on this computer nothing leaves it. A cloud provider only gets what you send it, with your own key. Off until you choose.
      </p>
      <div className="flex flex-col gap-3">
        <div>
          <span className="mb-1 block text-xs font-medium text-[var(--text-dim)]">Model runs on</span>
          <GlassSelect id="ai-provider" options={PROVIDERS} value={ai.provider} onChange={(v) => void save({ provider: v as AiSettings['provider'], model: '' }).then(() => setModels([]))} />
        </div>

        {ai.provider === 'local' && local && (
          <div className="flex flex-col gap-3">
            <p className="text-xs text-[var(--text-dim)]">A small open model that runs only on this computer. Nothing is sent anywhere. The download is checked against its published checksum.</p>
            <div>
              <span className="mb-1 block text-xs font-medium text-[var(--text-dim)]">Model</span>
              <GlassSelect id="ai-local-model" options={Object.entries(local.catalog).map(([id, m]) => ({ value: id, label: `${m.label} (${(m.sizeMB / 1000).toFixed(1)} GB)` }))} value={ai.localModel} onChange={(v) => void save({ localModel: v })} />
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-[var(--text-dim)]">Engine: {local.runtime ? 'installed' : 'not installed'} · Model: {local.models[ai.localModel] ? 'downloaded' : 'not downloaded'}</span>
            </div>
            {local.installing ? (
              <div className="flex flex-col gap-1">
                <ProgressBar value={local.installing.total ? local.installing.done / local.installing.total : 0} status="running" />
                <span className="text-[11px] text-[var(--text-dim)]">
                  {local.installing.what}: {formatBytes(local.installing.done)}{local.installing.total ? ` of ${formatBytes(local.installing.total)}` : ''}
                </span>
                <button type="button" className="glass-btn w-fit px-3 py-1 text-xs" onClick={() => void host.ai.local.cancel()}>
                  Stop (it continues where it stopped next time)
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {!local.runtime && (
                  <button type="button" className="glass-btn px-3 py-1.5 text-xs" onClick={() => run(() => host.ai.local.installRuntime())}>
                    Download the AI engine (about 30 MB)
                  </button>
                )}
                {local.runtime && !local.models[ai.localModel] && model && (
                  <button type="button" className="glass-btn px-3 py-1.5 text-xs" onClick={() => run(() => host.ai.local.installModel(ai.localModel))}>
                    Download the model (about {(model.sizeMB / 1000).toFixed(1)} GB)
                  </button>
                )}
                {ready && local.state !== 'ready' && local.state !== 'loading' && (
                  <button type="button" className="glass-btn px-3 py-1.5 text-xs" onClick={() => run(() => host.ai.local.load())}>
                    Load
                  </button>
                )}
                {(local.state === 'ready' || local.state === 'loading') && (
                  <button type="button" className="glass-btn px-3 py-1.5 text-xs" onClick={() => void host.ai.local.eject()}>
                    Eject (frees the memory)
                  </button>
                )}
                {local.models[ai.localModel] && (
                  <button type="button" className="glass-btn px-3 py-1.5 text-xs" onClick={() => void host.ai.local.remove(ai.localModel)}>
                    Delete the model
                  </button>
                )}
              </div>
            )}
            <p className={`text-xs ${local.state === 'error' ? 'text-red-400' : 'text-[var(--text-dim)]'}`}>
              {local.state === 'ready' ? `Ready: ${local.model}` : local.state === 'loading' ? 'Loading the model…' : local.state === 'error' ? local.error : ready ? 'Not loaded. It loads when you ask something, or press Load.' : ''}
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <span className="mb-1 block text-xs font-medium text-[var(--text-dim)]">Memory for the conversation</span>
                <GlassSelect id="ai-context" options={CONTEXTS} value={String(ai.context)} onChange={(v) => void save({ context: Number(v) as AiSettings['context'] })} />
              </div>
              <div>
                <span className="mb-1 block text-xs font-medium text-[var(--text-dim)]">Run on</span>
                <GlassSelect id="ai-gpu" options={[{ value: 'auto', label: 'The graphics card' }, { value: 'cpu', label: 'The processor only' }]} value={ai.gpu} onChange={(v) => void save({ gpu: v as AiSettings['gpu'] })} />
              </div>
              <div>
                <span className="mb-1 block text-xs font-medium text-[var(--text-dim)]">Eject when idle</span>
                <GlassSelect id="ai-idle" options={IDLE} value={String(ai.idleEject)} onChange={(v) => void save({ idleEject: Number(v) as AiSettings['idleEject'] })} />
              </div>
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" className="accent-[var(--accent)]" checked={ai.startOnLaunch} onChange={(e) => void save({ startOnLaunch: e.target.checked })} />
              Load the model when OPNduck starts (in the background)
            </label>
            <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-dim)]">
              <span className="min-w-0 truncate">Kept in: {local.dir}</span>
              <button type="button" className="glass-btn px-3 py-1 text-xs" disabled={!!local.installing} onClick={() =>
                  void host.pickFolder().then(async (d) => {
                    if (!d) return
                    await save({ dir: d })
                    setLocal(await host.ai.local.status())
                  })
                }>
                Change folder…
              </button>
            </div>
          </div>
        )}

        {detected && (
          <p className={`text-xs ${detected.running ? 'text-[var(--text-dim)]' : 'text-amber-400'}`}>
            {detected.running ? `${ai.provider === 'ollama' ? 'Ollama' : 'LM Studio'} is running with ${detected.models.length} model${detected.models.length === 1 ? '' : 's'}.` : `${ai.provider === 'ollama' ? 'Ollama' : 'LM Studio'} is not running. Start it, then press Check again.`}
          </p>
        )}

        {ai.provider === 'machine' && (
          <div className="flex flex-col gap-2">
            <input className="glass-input" aria-label="Address of the other computer" placeholder="http://100.x.y.z:1234/v1 or https://…" value={ai.machineUrl} onChange={(e) => setAi({ ...ai, machineUrl: e.target.value })} onBlur={() => void save({ machineUrl: ai.machineUrl })} />
            <span className="text-[11px] text-[var(--text-dim)]">Any OpenAI-compatible address: llama-server, Ollama or LM Studio on another PC over Tailscale, or an OPNduck Server. Plain http only works over Tailscale.</span>
          </div>
        )}

        {(ai.provider === 'machine' || ai.provider === 'cloud') && (
          <div className="flex flex-col gap-2">
            {ai.provider === 'cloud' && (
              <>
                <GlassSelect id="ai-cloud" options={Object.entries(state.cloud).map(([value, label]) => ({ value, label }))} value={ai.cloud} onChange={(v) => void save({ cloud: v, model: '' }).then(() => setModels([]))} />
                {ai.cloud === 'custom' && <input className="glass-input" aria-label="Custom address" placeholder="https://api.example.com/v1" value={ai.customUrl} onChange={(e) => setAi({ ...ai, customUrl: e.target.value })} onBlur={() => void save({ customUrl: ai.customUrl })} />}
              </>
            )}
            {hasKey ? (
              <div className="flex items-center gap-2 text-xs">
                <span className="text-[var(--text-dim)]">{ai.provider === 'machine' ? 'An access token is saved.' : `Your ${cloudLabel} key is saved.`}</span>
                <button type="button" className="glass-btn px-3 py-1" onClick={() => void host.ai.removeKey(keyId).then(refresh)}>
                  Remove
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <input type="password" className="glass-input min-w-0 flex-1" aria-label={ai.provider === 'machine' ? 'Access token (optional)' : 'API key'} placeholder={ai.provider === 'machine' ? 'Access token (if it needs one)' : 'Paste your API key'} value={ai.provider === 'machine' ? token : keyText} onChange={(e) => (ai.provider === 'machine' ? setToken(e.target.value) : setKeyText(e.target.value))} autoComplete="off" />
                <button
                  type="button"
                  className="glass-btn px-3 py-1.5 text-xs"
                  disabled={!(ai.provider === 'machine' ? token : keyText).trim()}
                  onClick={() =>
                    void host.ai
                      .setKey(keyId, (ai.provider === 'machine' ? token : keyText).trim())
                      .then(() => (setKeyText(''), setToken(''), refresh()))
                      .catch((e) => setNote({ ok: false, text: clean(e) }))
                  }
                >
                  Save
                </button>
              </div>
            )}
            {!state.encrypted && <span className="text-[11px] text-amber-400">This computer has no keyring, so keys are kept in a file only you can read, not encrypted.</span>}
            {ai.provider === 'cloud' && <span className="text-[11px] text-[var(--text-dim)]">Your messages, and any file names, frames or transcripts the AI needs, are sent to {cloudLabel}. The key is only ever sent to them.</span>}
          </div>
        )}

        {ai.provider !== 'off' && (
          <>
            <div>
              <span className="mb-1 block text-xs font-medium text-[var(--text-dim)]">Model</span>
              {choices.length > 0 ? (
                <GlassSelect id="ai-model" options={[{ value: '', label: 'Choose a model…' }, ...choices.map((m) => ({ value: m.id, label: m.name ?? m.id }))]} value={ai.model} onChange={(v) => void save({ model: v })} />
              ) : (
                <input className="glass-input" aria-label="Model name" placeholder="Model name (press Check to list them)" value={ai.model} onChange={(e) => setAi({ ...ai, model: e.target.value })} onBlur={() => void save({ model: ai.model })} />
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="glass-btn px-3 py-1.5 text-xs" onClick={() => void test().then(refresh)} disabled={busy}>
                {busy ? 'Checking…' : 'Check'}
              </button>
              {note && <span className={`text-xs ${note.ok ? 'text-[var(--text-dim)]' : 'text-red-400'}`}>{note.text}</span>}
            </div>

            {(() => {
              const u = usage[ai.provider === 'cloud' ? ai.cloud : ai.provider]
              return (
                <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--text-dim)]">
                  <span>{u ? `This month: ${(u.input + u.output).toLocaleString('en')} tokens in ${u.answers} answers` : 'Nothing used this month.'}</span>
                  {ai.provider === 'cloud' && (
                    <label className="flex items-center gap-2">
                      Stop at
                      <input type="number" min={0} step={10000} className="glass-input w-28" aria-label="Monthly token limit" value={ai.monthlyTokenLimit} onChange={(e) => setAi({ ...ai, monthlyTokenLimit: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} onBlur={() => void save({ monthlyTokenLimit: ai.monthlyTokenLimit })} />
                      tokens a month (0 = no limit)
                    </label>
                  )}
                </div>
              )
            })()}
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <span className="mb-1 block text-xs font-medium text-[var(--text-dim)]">Effort</span>
                <GlassSelect id="ai-effort" options={EFFORT} value={ai.effort} onChange={(v) => void save({ effort: v as AiSettings['effort'] })} />
              </div>
              <div>
                <span className="mb-1 block text-xs font-medium text-[var(--text-dim)]">Thinking</span>
                <GlassSelect id="ai-reasoning" options={REASONING} value={ai.reasoning} onChange={(v) => void save({ reasoning: v as AiSettings['reasoning'] })} />
              </div>
            </div>
            <div>
              <label htmlFor="ai-temp" className="mb-1 flex justify-between text-xs font-medium text-[var(--text-dim)]">
                <span>Temperature (how adventurous answers are)</span>
                <span>{ai.temperature}</span>
              </label>
              <input id="ai-temp" type="range" className="w-full accent-[var(--accent)]" min={0} max={1.5} step={0.1} value={ai.temperature} onChange={(e) => setAi({ ...ai, temperature: Number(e.target.value) })} onMouseUp={() => void save({ temperature: ai.temperature })} onKeyUp={() => void save({ temperature: ai.temperature })} />
            </div>
            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1 accent-[var(--accent)]" checked={ai.vision} onChange={(e) => void save({ vision: e.target.checked })} />
              <span>
                Let the model see pictures
                <span className="block text-[11px] text-[var(--text-dim)]">Needs a model that can look at images. Off means no frame or picture is ever sent.</span>
              </span>
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" className="accent-[var(--accent)]" checked={ai.keepChats} onChange={(e) => void save({ keepChats: e.target.checked })} />
              Keep my conversations on this computer
            </label>
          </>
        )}
        {ai.provider === 'off' && note && <span className="text-xs text-red-400">{note.text}</span>}
      </div>
    </div>
  )
}
// --- end: settings/ai ---
