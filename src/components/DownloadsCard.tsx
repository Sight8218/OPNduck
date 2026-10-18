import { useEffect, useState } from 'react'
import { host, type AppSettings } from '../host'
import GlassSelect from './GlassSelect'

type CookieMode = AppSettings['cookies']['mode']

const COOKIE_MODES: { value: CookieMode; label: string }[] = [
  { value: 'none', label: 'Off (public videos only)' },
  { value: 'browser', label: "Use my browser's login" },
  { value: 'login', label: 'Sign in inside OPNduck' },
  { value: 'file', label: 'Use a cookies.txt file' },
]

const BROWSERS = ['firefox', 'chromium', 'chrome', 'edge', 'brave', 'opera', 'vivaldi'].map((b) => ({
  value: b,
  label: b === 'edge' ? 'Microsoft Edge' : b[0].toUpperCase() + b.slice(1),
}))

/** Electron wraps main-process errors in a long prefix; show only the message. */
const cleanError = (err: unknown) =>
  (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/**
 * Settings > Downloads: options that apply to every yt-dlp call (probes and downloads alike).
 * Stored by the main process (electron/settings.cjs), which validates every value.
 */
export default function DownloadsCard() {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [proxy, setProxy] = useState('')
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null)
  const [profile, setProfile] = useState('')
  const [cookieFile, setCookieFile] = useState('')
  const [loginSite, setLoginSite] = useState('')
  const [signedIn, setSignedIn] = useState<{ signedIn: boolean; cookies: number; updatedAt: number | null } | null>(null)
  const [busy, setBusy] = useState<'login' | 'test' | null>(null)
  const [cookieStatus, setCookieStatus] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    host.settings?.get().then((s) => {
      setSettings(s)
      setProxy(s.proxy)
      setProfile(s.cookies.profile)
      setCookieFile(s.cookies.file)
    })
    host.login?.status().then(setSignedIn)
  }, [])

  if (!host.settings || !settings) return null

  async function save(next: string) {
    try {
      const s = await host.settings!.set({ proxy: next })
      setSettings(s)
      setProxy(s.proxy)
      setStatus({ ok: true, text: s.proxy ? 'Proxy saved — new downloads and link checks will use it.' : 'Proxy turned off.' })
    } catch (err) {
      setStatus({ ok: false, text: cleanError(err) })
    }
  }

  async function setCookies(patch: Partial<AppSettings['cookies']>) {
    setCookieStatus(null)
    try {
      setSettings(await host.settings!.set({ cookies: patch }))
    } catch (err) {
      setCookieStatus({ ok: false, text: cleanError(err) })
    }
  }

  async function signIn() {
    setBusy('login')
    setCookieStatus({ ok: true, text: 'Sign in in the window that opened, then close it when you are done.' })
    try {
      const r = await host.login!.open(loginSite.trim() || undefined)
      setSignedIn(await host.login!.status())
      setSettings(await host.settings!.get())
      setCookieStatus(
        r.ok
          ? { ok: r.cookies > 0, text: r.cookies > 0 ? `Saved ${r.cookies} cookies. OPNduck will use them for downloads.` : 'No cookies were saved — did you finish signing in?' }
          : { ok: false, text: r.error ?? 'Sign-in failed.' },
      )
    } catch (err) {
      setCookieStatus({ ok: false, text: cleanError(err) })
    } finally {
      setBusy(null)
    }
  }

  async function signOut() {
    await host.login!.clear()
    setSignedIn(await host.login!.status())
    setSettings(await host.settings!.get())
    setCookieStatus({ ok: true, text: 'Signed out — the saved cookies were deleted.' })
  }

  async function testLogin() {
    setBusy('test')
    setCookieStatus({ ok: true, text: 'Checking…' })
    try {
      setCookieStatus(await host.login!.test().then((r) => ({ ok: r.ok, text: r.message })))
    } catch (err) {
      setCookieStatus({ ok: false, text: cleanError(err) })
    } finally {
      setBusy(null)
    }
  }

  async function chooseCookieFile() {
    const picked = await host.pickFile({ extensions: ['txt'] })
    if (!picked) return
    setCookieFile(picked)
    setCookies({ file: picked })
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

      <div className="mt-5 flex flex-col gap-3 border-t border-[var(--glass-border)] pt-4">
        <div>
          <h3 className="text-sm font-medium">Sign in for private videos</h3>
          <p className="text-xs text-[var(--text-dim)]">
            Needed for Watch Later, Liked videos, private playlists and age-restricted or login-only media. OPNduck never sees
            your password — it only keeps the login cookies.
          </p>
        </div>
        <GlassSelect
          id="cookie-mode"
          options={COOKIE_MODES}
          value={settings.cookies.mode}
          onChange={(mode) => setCookies({ mode })}
        />

        {settings.cookies.mode === 'browser' && (
          <div className="flex flex-col gap-2">
            <GlassSelect
              id="cookie-browser"
              options={BROWSERS}
              value={settings.cookies.browser}
              onChange={(browser) => setCookies({ browser })}
            />
            <input
              className="glass-input"
              placeholder="Browser profile (optional) — a name, or the profile folder's full path"
              value={profile}
              onChange={(e) => setProfile(e.target.value)}
              onBlur={() => profile !== settings.cookies.profile && setCookies({ profile: profile.trim() })}
              onKeyDown={(e) => e.key === 'Enter' && setCookies({ profile: profile.trim() })}
              spellCheck={false}
            />
            <span className="text-xs text-[var(--text-faint)]">
              Stay signed in to YouTube in that browser; OPNduck reads its cookies when needed. Close the browser first if it
              reports a locked database.
            </span>
          </div>
        )}

        {settings.cookies.mode === 'file' && (
          <div className="flex flex-wrap gap-2">
            <input
              className="glass-input min-w-0 flex-1"
              placeholder="Full path to a cookies.txt (Netscape format)"
              value={cookieFile}
              onChange={(e) => setCookieFile(e.target.value)}
              onBlur={() => cookieFile !== settings.cookies.file && setCookies({ file: cookieFile.trim() })}
              onKeyDown={(e) => e.key === 'Enter' && setCookies({ file: cookieFile.trim() })}
              spellCheck={false}
            />
            <button type="button" className="glass-btn shrink-0 px-4" onClick={chooseCookieFile}>
              Choose file…
            </button>
          </div>
        )}

        {settings.cookies.mode === 'login' && (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="glass-btn shrink-0 px-4" onClick={signIn} disabled={busy !== null}>
                {busy === 'login' ? 'Waiting for you…' : signedIn?.signedIn ? 'Sign in again' : 'Sign in…'}
              </button>
              {signedIn?.signedIn && (
                <button type="button" className="glass-btn shrink-0 px-4" onClick={signOut} disabled={busy !== null}>
                  Sign out
                </button>
              )}
              <span className="text-xs text-[var(--text-dim)]">
                {signedIn?.signedIn
                  ? `Signed in — ${signedIn.cookies} cookies saved${signedIn.updatedAt ? ` (${new Date(signedIn.updatedAt).toLocaleDateString()})` : ''}.`
                  : 'Not signed in.'}
              </span>
            </div>
            <input
              className="glass-input"
              placeholder="Another site to sign in to (https://…) — empty = YouTube"
              value={loginSite}
              onChange={(e) => setLoginSite(e.target.value)}
              spellCheck={false}
            />
            <span className="text-xs text-[var(--text-faint)]">
              Some sites (Google especially) may refuse sign-in from inside an app. If that happens, choose "Use my browser's
              login" instead.
            </span>
          </div>
        )}

        {settings.cookies.mode !== 'none' && (
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className="glass-btn shrink-0 px-4" onClick={testLogin} disabled={busy !== null}>
              {busy === 'test' ? 'Checking…' : 'Test sign-in'}
            </button>
            {cookieStatus && (
              <span className={`text-xs ${cookieStatus.ok ? 'text-[var(--text-dim)]' : 'text-red-400'}`}>{cookieStatus.text}</span>
            )}
          </div>
        )}
        {settings.cookies.mode === 'none' && cookieStatus && (
          <span className={`text-xs ${cookieStatus.ok ? 'text-[var(--text-dim)]' : 'text-red-400'}`}>{cookieStatus.text}</span>
        )}
        <span className="text-xs text-[var(--text-faint)]">
          Heads up: using your account with a downloader can occasionally get that account rate-limited or flagged by the
          site. Consider a secondary account for heavy use.
        </span>
      </div>
    </div>
  )
}
