import { useEffect, useState } from 'react'
import { host, type AppSettings } from '../host'

/**
 * Settings > Downloads: options that apply to every yt-dlp call (probes and downloads alike).
 * Stored by the main process (electron/settings.cjs), which validates every value.
 */
export default function DownloadsCard() {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [proxy, setProxy] = useState('')
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    host.settings?.get().then((s) => {
      setSettings(s)
      setProxy(s.proxy)
    })
  }, [])

  if (!host.settings || !settings) return null

  async function save(next: string) {
    try {
      const s = await host.settings!.set({ proxy: next })
      setSettings(s)
      setProxy(s.proxy)
      setStatus({ ok: true, text: s.proxy ? 'Proxy saved — new downloads and link checks will use it.' : 'Proxy turned off.' })
    } catch (err) {
      setStatus({ ok: false, text: (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') })
    }
  }

  return (
    <div className="glass rounded-3xl p-5">
      <h2 className="mb-1 text-base font-bold">Downloads</h2>
      <p className="mb-4 text-xs text-[var(--text-dim)]">
        Applies to every download and link check. Use a proxy to reach sites your network blocks.
      </p>
      <div className="flex flex-col gap-2">
        <label htmlFor="download-proxy" className="text-sm font-medium">
          Proxy
        </label>
        <div className="flex flex-wrap gap-2">
          <input
            id="download-proxy"
            className="glass-input min-w-0 flex-1"
            placeholder="http://host:8080   or   socks5://host:1080   (empty = none)"
            value={proxy}
            onChange={(e) => {
              setProxy(e.target.value)
              setStatus(null)
            }}
            onKeyDown={(e) => e.key === 'Enter' && save(proxy)}
            spellCheck={false}
          />
          <button type="button" className="glass-btn shrink-0 px-4" onClick={() => save(proxy)} disabled={proxy.trim() === settings.proxy}>
            Save
          </button>
          {settings.proxy && (
            <button type="button" className="glass-btn shrink-0 px-4" onClick={() => save('')}>
              Turn off
            </button>
          )}
        </div>
        {status && <span className={`text-xs ${status.ok ? 'text-[var(--text-dim)]' : 'text-red-400'}`}>{status.text}</span>}
        <span className="text-xs text-[var(--text-faint)]">
          OPNduck doesn't provide a proxy — enter the address of one you run or trust.
        </span>
      </div>
    </div>
  )
}
