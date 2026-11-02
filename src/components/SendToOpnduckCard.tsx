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
import QRCode from 'qrcode'
import { host, type AppSettings, type RemoteServer, type TailscaleStatus } from '../host'

const FORMATS = ['MP4', 'MKV', 'WEBM', 'MOV', 'AVI', 'MP3', 'FLAC', 'WAV']
const QUALITIES = [
  { value: 'best', label: 'Best' },
  { value: '2160', label: '2160p' },
  { value: '1440', label: '1440p' },
  { value: '1080', label: '1080p' },
  { value: '720', label: '720p' },
  { value: '480', label: '480p' },
]

// @category: settings/send-to-opnduck
/** Settings > Send to OPNduck: accept links from other devices, and say what happens to them. */
export default function SendToOpnduckCard() {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    host.settings?.get().then(setSettings)
  }, [])

  async function change(patch: Partial<Pick<AppSettings, 'remoteEnabled' | 'remoteMode' | 'remoteFormat' | 'remoteVideoQuality' | 'remoteBind' | 'remotePort'>>) {
    setError('')
    try {
      const next = await host.settings!.set(patch)
      setSettings(next)
    } catch (e) {
      setError((e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']*': (Error: )?/, ''))
    }
  }
  if (!settings) return null

  const audio = ['MP3', 'FLAC', 'WAV'].includes(settings.remoteFormat)
  return (
    <div className="glass rounded-3xl p-5">
      <h2 className="mb-1 text-base font-bold">Send to OPNduck</h2>
      <p className="mb-2 text-xs text-[var(--text-dim)]">Send a link from your phone, a browser or another computer, and OPNduck downloads it. Only the link travels; the format and folder always come from here.</p>
      <label className="flex cursor-pointer items-start gap-3 py-2">
        <input type="checkbox" className="mt-0.5 accent-[var(--accent)]" checked={settings.remoteEnabled} onChange={(e) => void change({ remoteEnabled: e.target.checked })} />
        <span>
          <span className="text-sm font-medium">Accept links from other devices</span>
          <span className="block text-[11px] text-[var(--text-dim)]">Includes <code>opnduck://send?url=…</code> links from web pages (these always wait for your click). Off by default.</span>
        </span>
      </label>
      {settings.remoteEnabled && (
        <div className="flex flex-col gap-3 border-t border-[var(--glass-border)] pt-3">
          <div>
            <span className="mb-1 block text-xs font-medium text-[var(--text-dim)]">When a link arrives</span>
            <div className="flex flex-wrap gap-1.5">
              {[
                { v: 'ask' as const, l: 'Ask me first' },
                { v: 'auto' as const, l: 'Download straight away' },
              ].map((o) => (
                <button key={o.v} type="button" aria-pressed={settings.remoteMode === o.v} onClick={() => void change({ remoteMode: o.v })} className={`rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors ${settings.remoteMode === o.v ? 'border-[var(--input-border-focus)] bg-[var(--input-bg)] text-[var(--accent)]' : 'border-[var(--glass-border)] text-[var(--text-dim)] hover:text-[var(--text)]'}`}>
                  {o.l}
                </button>
              ))}
            </div>
            {settings.remoteMode === 'auto' && <span className="mt-1 block text-[11px] text-[var(--text-faint)]">Links from paired devices start downloading without asking. Links opened from web pages still ask.</span>}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="remote-format" className="mb-1 block text-xs font-medium text-[var(--text-dim)]">Download as</label>
              <select id="remote-format" className="glass-input" value={settings.remoteFormat} onChange={(e) => void change({ remoteFormat: e.target.value })}>
                {FORMATS.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </div>
            {!audio && (
              <div>
                <label htmlFor="remote-quality" className="mb-1 block text-xs font-medium text-[var(--text-dim)]">Video quality</label>
                <select id="remote-quality" className="glass-input" value={settings.remoteVideoQuality} onChange={(e) => void change({ remoteVideoQuality: e.target.value })}>
                  {QUALITIES.map((q) => (
                    <option key={q.value} value={q.value}>
                      {q.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>
      )}
      {settings.remoteEnabled && <DirectAndPairing settings={settings} onChange={change} />}
      {error && <span className="mt-2 block text-xs text-red-400">{error}</span>}
    </div>
  )
}

const BINDS: { value: AppSettings['remoteBind']; label: string; hint: string }[] = [
  { value: 'off', label: 'Off', hint: 'No port is opened. Links can still arrive through opnduck:// links.' },
  { value: 'localhost', label: 'This computer only', hint: 'For the browser extension on this computer.' },
  { value: 'tailscale', label: 'This computer and Tailscale', hint: 'Also reachable from your own devices on your Tailscale network, and nowhere else.' },
  { value: 'lan', label: 'Whole home network', hint: 'Anyone on your Wi-Fi or LAN can reach the port (they still need the secret). Only for advanced use.' },
]

function DirectAndPairing({ settings, onChange }: { settings: AppSettings; onChange: (p: Partial<Pick<AppSettings, 'remoteBind' | 'remotePort'>>) => Promise<void> }) {
  const [server, setServer] = useState<RemoteServer | null>(null)
  const [ts, setTs] = useState<TailscaleStatus | null>(null)
  const [qr, setQr] = useState('')
  const [link, setLink] = useState('')
  const [copied, setCopied] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const [msg, setMsg] = useState<{ error: string; command: string } | null>(null)
  const [port, setPort] = useState(String(settings.remotePort))

  const refresh = useCallback(async () => {
    setServer(await host.remote.server())
    if (settings.remoteBind === 'tailscale') setTs(await host.remote.tailscale())
    const { link: l } = await host.remote.pairing()
    setLink(l)
    setQr(l ? await QRCode.toDataURL(l, { margin: 1, width: 220, errorCorrectionLevel: 'M' }) : '')
  }, [settings.remoteBind])

  useEffect(() => {
    void refresh()
    return host.remote.onChange(() => void refresh())
  }, [refresh, settings.remoteDirectUrl])

  async function serve(on: boolean) {
    setMsg(null)
    const r = await host.remote.tailscaleServe(on)
    if (!r.ok) setMsg({ error: r.error, command: r.command })
    await refresh()
  }

  return (
    <div className="mt-3 flex flex-col gap-3 border-t border-[var(--glass-border)] pt-3">
      <div>
        <span className="mb-1 block text-xs font-medium text-[var(--text-dim)]">Pair a phone or browser</span>
        <div className="flex flex-wrap items-start gap-4">
          {qr ? <img src={qr} width={140} height={140} alt="QR code to pair a device" className="rounded-lg bg-white p-1" /> : null}
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <span className="text-[11px] text-[var(--text-dim)]">
              Scan this with your phone's camera, or copy the link into the browser extension. It holds a private key, so only share it with your own devices. The key sits after the # in the link, which browsers never send to a website.
            </span>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="glass-btn"
                onClick={() => {
                  void navigator.clipboard.writeText(link).then(() => {
                    setCopied(true)
                    setTimeout(() => setCopied(false), 1500)
                  })
                }}
              >
                {copied ? 'Copied' : 'Copy pair link'}
              </button>
              {!confirmReset ? (
                <button type="button" className="glass-btn" onClick={() => setConfirmReset(true)}>
                  Reset pairing
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="glass-btn text-red-400"
                    onClick={() => {
                      void host.remote.resetPairing().then(() => {
                        setConfirmReset(false)
                        void refresh()
                      })
                    }}
                  >
                    Unpair every device
                  </button>
                  <button type="button" className="glass-btn" onClick={() => setConfirmReset(false)}>
                    Keep
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <div>
        <span className="mb-1 block text-xs font-medium text-[var(--text-dim)]">Direct connection</span>
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label="Who can reach the link server" className="glass-input w-auto" value={settings.remoteBind} onChange={(e) => void onChange({ remoteBind: e.target.value as AppSettings['remoteBind'] })}>
            {BINDS.map((b) => (
              <option key={b.value} value={b.value}>
                {b.label}
              </option>
            ))}
          </select>
          {settings.remoteBind !== 'off' && (
            <label className="flex items-center gap-1.5 text-xs text-[var(--text-dim)]">
              Port
              <input className="glass-input w-24" inputMode="numeric" value={port} onChange={(e) => setPort(e.target.value)} onBlur={() => Number(port) !== settings.remotePort && void onChange({ remotePort: Number(port) })} />
            </label>
          )}
        </div>
        <span className="mt-1 block text-[11px] text-[var(--text-faint)]">{BINDS.find((b) => b.value === settings.remoteBind)?.hint}</span>
        {server && settings.remoteBind !== 'off' && (
          <span className={`mt-1 block text-[11px] ${server.error ? 'text-red-400' : 'text-[var(--text-dim)]'}`}>
            {server.running ? `Listening on ${server.addresses.join(', ')} port ${server.port}` : server.error || 'Not listening'}
          </span>
        )}
        {settings.remoteBind === 'lan' && <span className="mt-1 block text-[11px] text-red-400">Careful: this opens the port to your whole network.</span>}

        {settings.remoteBind === 'tailscale' && ts && (
          <div className="mt-2 flex flex-col gap-1 rounded-lg bg-[var(--input-bg)] p-2 text-[11px] text-[var(--text-dim)]">
            {!ts.installed ? (
              <span>
                Tailscale is not installed. <a className="text-[var(--accent)] underline" href={ts.downloadUrl} target="_blank" rel="noreferrer">Get Tailscale</a>. Everything else still works through the relay.
              </span>
            ) : !ts.running ? (
              <span>Tailscale is installed but not connected. Turn it on, then reopen this page.</span>
            ) : (
              <>
                <span>
                  This computer on Tailscale: {ts.dnsName ?? ts.ip}
                  {ts.ip ? ` (${ts.ip})` : ''}
                </span>
                {settings.remoteDirectUrl ? (
                  <span>
                    HTTPS address (for the phone page): {settings.remoteDirectUrl}{' '}
                    <button type="button" className="text-[var(--accent)] underline" onClick={() => void serve(false)}>
                      Remove
                    </button>
                  </span>
                ) : ts.httpsAvailable ? (
                  <span>
                    A phone's web page needs an HTTPS address to reach this computer.{' '}
                    <button type="button" className="text-[var(--accent)] underline" onClick={() => void serve(true)}>
                      Enable HTTPS over Tailscale
                    </button>
                  </span>
                ) : (
                  <span>
                    HTTPS is not switched on for your tailnet. Turn on HTTPS certificates in the Tailscale admin page (DNS tab) to use the direct path from a phone web page; the relay works without it.
                  </span>
                )}
              </>
            )}
            {msg && (
              <span className="text-red-400">
                {msg.error}
                {msg.command && (
                  <>
                    {' '}
                    Command: <code>{msg.command}</code>
                  </>
                )}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
