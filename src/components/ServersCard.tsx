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
import { host, type ServerEntry, type ServerStatus, type ShareState } from '../host'
import { formatBytes } from '../lib/formatBytes'
import GlassSelect from './GlassSelect'

const KIND_LABELS: Record<string, string> = {
  download: 'Downloads',
  convert: 'Conversions',
  upscale_image: 'Image upscaling',
  upscale_video: 'Video upscaling',
  interpolate: 'Frame interpolation',
  subtitles: 'Subtitles',
  trim: 'Trimming',
  compress: 'Compressing',
  make_gif: 'GIFs and stickers',
  jump_cut: 'Jump cuts',
  restore: 'Restore old video',
  beat_analyze: 'Beat Finder',
  grade: 'Colour grading',
  remove_background: 'Background remover',
  dub_video: 'Dubbing',
  audio_ai: 'Vocal remover',
}
const clean = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']*': (Error: )?/, '')

// @category: settings/servers
/** Settings > Servers: OPNduck servers this app can run jobs on, and sharing this PC's engine with other devices. */
export default function ServersCard() {
  const [list, setList] = useState<ServerEntry[]>([])
  const [defaults, setDefaults] = useState<Record<string, string>>({})
  const [encrypted, setEncrypted] = useState(true)
  const [status, setStatus] = useState<Record<string, ServerStatus | 'checking'>>({})
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [share, setShare] = useState<ShareState | null>(null)
  const [pairQr, setPairQr] = useState<{ link: string; qr: string } | null>(null)
  const [copied, setCopied] = useState(false)

  const check = useCallback((id: string) => {
    setStatus((s) => ({ ...s, [id]: 'checking' }))
    void host.servers.check(id).then((r) => setStatus((s) => ({ ...s, [id]: r })))
  }, [])
  const load = useCallback(async () => {
    const r = await host.servers.list()
    setList(r.servers)
    setDefaults(r.defaults)
    setEncrypted(r.encrypted)
    setShare(await host.servers.shareState())
    return r.servers
  }, [])
  useEffect(() => {
    void load().then((servers) => servers.forEach((s) => check(s.id)))
    return host.servers.onChange(() => void load())
  }, [load, check])

  if (!host.isDesktop) return null

  async function add(text: string) {
    setError('')
    setBusy(true)
    try {
      const added = await host.servers.add(text.trim())
      setLink('')
      await load()
      check(added.id)
    } catch (e) {
      setError(clean(e))
    } finally {
      setBusy(false)
    }
  }
  async function setShareOn(on: boolean) {
    setError('')
    setPairQr(null)
    try {
      if (on && share?.bind === 'off') await host.settings!.set({ remoteBind: 'tailscale' })
      await host.settings!.set({ shareEngine: on })
      await load()
    } catch (e) {
      setError(clean(e))
    }
  }
  async function newPairLink() {
    setError('')
    try {
      const { link: l } = await host.servers.sharePairLink()
      setPairQr({ link: l, qr: await (await import('qrcode')).default.toDataURL(l, { margin: 1, width: 220, errorCorrectionLevel: 'M' }) })
    } catch (e) {
      setError(clean(e))
    }
  }

  const kinds = [...new Set(Object.values(status).flatMap((s) => (s !== 'checking' && s.online && !s.mismatch ? (s.kinds ?? []) : [])))].filter((k) => KIND_LABELS[k])
  const placeOptions = [{ value: 'ask', label: 'Ask each time' }, { value: 'local', label: 'This PC' }, ...list.map((s) => ({ value: s.id, label: s.name }))]

  return (
    <div className="glass rounded-3xl p-5">
      <h2 className="mb-1 text-base font-bold">Servers</h2>
      <p className="mb-3 text-xs text-[var(--text-dim)]">
        Run heavy jobs on another machine, like a home server or a gaming PC. Files travel only to servers you pair yourself, and results come back here.
      </p>

      {list.length === 0 && <p className="mb-3 text-xs text-[var(--text-dim)]">No server yet. On the server run <code>opnduck-server pair</code>, then paste the link below.</p>}
      <div className="mb-3 flex flex-col gap-2">
        {list.map((s) => {
          const st = status[s.id]
          const ok = st && st !== 'checking' && st.online && !st.mismatch
          return (
            <div key={s.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-[var(--input-bg)] p-2">
              <div className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{s.name}</span>
                <span className="block truncate text-[11px] text-[var(--text-dim)]">
                  {st === 'checking' || !st ? 'Checking…' : !st.online ? `Offline: ${st.error}` : st.mismatch ? `Version mismatch: ${st.error}` : `Online · OPNduck ${st.version}${st.gpus?.length ? ` · ${st.gpus.join(', ')}` : ''}${formatBytes(st.freeDiskBytes) ? ` · ${formatBytes(st.freeDiskBytes)} free` : ''}`}
                </span>
                {s.transport === 'lan-http' && (
                  <span className="block text-[11px] text-amber-400">This connection is not encrypted. Anyone on your network could read the files. Use Tailscale or HTTPS.</span>
                )}
                {ok && st.tools && !st.tools.ffmpeg && <span className="block text-[11px] text-amber-400">This server has no FFmpeg installed.</span>}
              </div>
              <button type="button" className="glass-btn px-3 py-1 text-xs" onClick={() => check(s.id)}>
                Check
              </button>
              <button
                type="button"
                className="glass-btn px-3 py-1 text-xs"
                onClick={() => void host.servers.remove(s.id).then(() => load())}
              >
                Remove
              </button>
            </div>
          )
        })}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={link}
          onChange={(e) => setLink(e.target.value)}
          placeholder="opnduck://pair?…"
          aria-label="Server pair link"
          className="min-w-0 flex-1 rounded-xl bg-[var(--input-bg)] px-3 py-2 text-sm outline-none"
        />
        <button type="button" className="glass-btn px-3 py-1.5 text-xs" disabled={busy || !link.trim()} onClick={() => void add(link)}>
          {busy ? 'Pairing…' : 'Add server'}
        </button>
        <button
          type="button"
          className="glass-btn px-3 py-1.5 text-xs"
          disabled={busy}
          onClick={() => void navigator.clipboard.readText().then((t) => (setLink(t), add(t))).catch(() => setError('Allow pasting, or paste the link into the box.'))}
        >
          Paste &amp; add
        </button>
      </div>
      {!encrypted && <p className="mb-3 text-[11px] text-amber-400">This computer has no keyring, so a server's access token is stored in a file only you can read, not encrypted.</p>}

      {kinds.length > 0 && (
        <div className="mb-4">
          <span className="mb-1 block text-xs font-medium text-[var(--text-dim)]">Run each kind of job on</span>
          <div className="grid gap-2 sm:grid-cols-2">
            {kinds.map((k) => (
              <div key={k} className="flex items-center gap-2">
                <span className="w-36 shrink-0 truncate text-xs">{KIND_LABELS[k]}</span>
                <div className="min-w-0 flex-1">
                  <GlassSelect id={`server-default-${k}`} options={placeOptions} value={defaults[k] ?? 'local'} onChange={(v) => void host.servers.setDefault(k, v).then(setDefaults).catch((e) => setError(clean(e)))} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="border-t border-[var(--border,rgba(255,255,255,0.08))] pt-3">
        <label className="flex cursor-pointer items-start gap-3 py-1">
          <input type="checkbox" className="mt-0.5 accent-[var(--accent)]" checked={share?.enabled ?? false} onChange={(e) => void setShareOn(e.target.checked)} />
          <span>
            <span className="block text-sm font-medium">Share this PC's engine</span>
            <span className="block text-xs text-[var(--text-dim)]">Let another OPNduck (or the phone app) run jobs on this computer. It uses the link server, so choose who can connect under Send to OPNduck.</span>
          </span>
        </label>
        {share?.enabled && (
          <div className="mt-2 flex flex-col gap-2 text-xs text-[var(--text-dim)]">
            <div className="flex flex-wrap items-center gap-2">
              <span>Who can connect:</span>
              <div className="w-56">
                <GlassSelect
                  id="share-bind"
                  options={[
                    { value: 'off', label: 'Nobody (off)' },
                    { value: 'localhost', label: 'This computer only' },
                    { value: 'tailscale', label: 'This computer and Tailscale' },
                    { value: 'lan', label: 'My whole network' },
                  ]}
                  value={share.bind}
                  onChange={(v) => void host.settings!.set({ remoteBind: v }).then(() => load()).catch((e) => setError(clean(e)))}
                />
              </div>
            </div>
            {share.bind === 'lan' && <span className="text-amber-400">Everyone on your network can reach the sign-in page, and the connection is not encrypted. Tailscale is safer.</span>}
            <span>{share.listening ? `Listening. Other devices use ${share.urls[0] ?? 'this computer'}` : share.error || 'Not listening: choose who can connect.'}</span>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="glass-btn px-3 py-1.5 text-xs" disabled={!share.listening} onClick={() => void newPairLink()}>
                New pair link
              </button>
            </div>
            {pairQr && (
              <div className="flex flex-col gap-2">
                <img src={pairQr.qr} alt="Pair link as a QR code" width={160} height={160} className="rounded-xl bg-white p-1" />
                <span>Scan it, or copy the link into the other OPNduck (Settings, Servers). It works once and expires in 5 minutes.</span>
                <button
                  type="button"
                  className="glass-btn w-fit px-3 py-1.5 text-xs"
                  onClick={() => void navigator.clipboard.writeText(pairQr.link).then(() => (setCopied(true), setTimeout(() => setCopied(false), 1500)))}
                >
                  {copied ? 'Copied' : 'Copy pair link'}
                </button>
              </div>
            )}
            {share.devices.length > 0 && (
              <div className="flex flex-col gap-1">
                <span className="font-medium">Paired devices</span>
                {share.devices.map((d) => (
                  <div key={d.id} className="flex items-center gap-2 rounded-xl bg-[var(--input-bg)] p-2">
                    <span className="min-w-0 flex-1 truncate">
                      {d.name} <span className="text-[var(--text-dim)]">· {d.kind}</span>
                    </span>
                    <button type="button" className="glass-btn px-3 py-1 text-xs" onClick={() => void host.servers.shareRevoke(d.id).then(() => load())}>
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </div>
  )
}
// --- end: settings/servers ---
