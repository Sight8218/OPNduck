import { useCallback, useEffect, useRef, useState } from 'react'
import { native } from './lib/native'
import { addHostFromLink, loadHosts, removeHost, type Host } from './lib/hosts'
import { engine, type Task } from './lib/engine'
import { PRESETS, linkIn, sendTo, type PresetId } from './lib/send'
import QrScanner from './QrScanner'

type Tab = 'send' | 'queue' | 'done' | 'settings'
const POLL_MS = 2000
const store = {
  get: (k: string) => {
    try {
      return localStorage.getItem(`opnduck.${k}`)
    } catch {
      return null
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(`opnduck.${k}`, v)
    } catch {
      /* storage unavailable: the choice is not remembered */
    }
  },
}
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

export default function App() {
  const [hosts, setHosts] = useState<Host[] | null>(null)
  const [hostId, setHostId] = useState(() => store.get('host') ?? '')
  const [tab, setTab] = useState<Tab>('send')
  const [tasks, setTasks] = useState<Task[]>([])
  const [offline, setOffline] = useState('')
  const [shared, setShared] = useState('')
  const [deviceName, setDeviceName] = useState(() => store.get('device-name') ?? 'My phone')
  const host = hosts?.find((h) => h.id === hostId) ?? hosts?.[0] ?? null

  useEffect(() => {
    void loadHosts().then(setHosts)
  }, [])

  // Text shared to the app from another app's share menu (at launch, or while the app is open).
  useEffect(() => {
    const take = () =>
      void native.consumeShared().then((r) => {
        if (r.text) {
          setShared(r.text)
          setTab('send')
        }
      })
    take()
    const sub = native.addListener('shared', take)
    return () => void sub.then((s) => s.remove())
  }, [])

  // The queue: asked for every couple of seconds while the app is open and the computer is paired for jobs.
  const refresh = useCallback(async () => {
    if (!host?.engine) return setTasks([])
    try {
      setTasks(await engine.tasks(host))
      setOffline('')
    } catch (e) {
      setOffline(errText(e))
    }
  }, [host])
  useEffect(() => {
    void refresh()
    const t = setInterval(() => document.visibilityState === 'visible' && void refresh(), POLL_MS)
    return () => clearInterval(t)
  }, [refresh])

  if (!hosts) return null
  const active = tasks.filter((t) => t.status === 'queued' || t.status === 'running')
  const done = tasks.filter((t) => t.status === 'done' || t.status === 'error' || t.status === 'canceled')

  return (
    <>
      <header>
        <img className="duck" src="/icon-192.png" alt="" />
        <img className="word" src="/logo.svg" alt="OPNduck" />
        {hosts.length > 1 && (
          <select
            aria-label="Computer"
            value={host?.id}
            onChange={(e) => {
              setHostId(e.target.value)
              store.set('host', e.target.value)
            }}
          >
            {hosts.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
        )}
      </header>
      <main>
        {!host ? (
          <Pair deviceName={deviceName} onPaired={(list, added) => (setHosts(list), setHostId(added.id), store.set('host', added.id))} />
        ) : tab === 'send' ? (
          <Send host={host} deviceName={deviceName} shared={shared} onUsed={() => setShared('')} onSent={() => void refresh()} />
        ) : tab === 'queue' ? (
          <Queue host={host} tasks={active} offline={offline} onChange={refresh} />
        ) : tab === 'done' ? (
          <Done host={host} tasks={done} offline={offline} onChange={refresh} />
        ) : (
          <Settings
            hosts={hosts}
            deviceName={deviceName}
            onDeviceName={(n) => (setDeviceName(n), store.set('device-name', n))}
            onHosts={setHosts}
            onPaired={(list, added) => (setHosts(list), setHostId(added.id))}
          />
        )}
      </main>
      {host && (
        <nav>
          {(['send', 'queue', 'done', 'settings'] as Tab[]).map((t) => (
            <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
              {t[0].toUpperCase() + t.slice(1)}
              {t === 'queue' && active.length > 0 && <span className="count">{active.length}</span>}
            </button>
          ))}
        </nav>
      )}
    </>
  )
}

function Pair({ deviceName, onPaired }: { deviceName: string; onPaired: (list: Host[], added: Host) => void }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [scan, setScan] = useState(false)
  const submit = useCallback(
    async (link: string) => {
      setBusy(true)
      setMsg('')
      try {
        const { hosts, added } = await addHostFromLink(link, deviceName)
        onPaired(hosts, added)
      } catch (e) {
        setMsg(errText(e))
      } finally {
        setBusy(false)
      }
    },
    [deviceName, onPaired],
  )
  const onScan = useCallback(
    (t: string) => {
      setScan(false)
      setText(t)
      void submit(t)
    },
    [submit],
  )
  return (
    <>
      <div>
        <h1>Pair with your computer</h1>
        <p>Open OPNduck on your computer, then Settings and Send to OPNduck (or Servers, Share this PC's engine) and scan the QR code.</p>
      </div>
      <div className="panel">
        <button onClick={() => setScan(true)}>Scan QR code</button>
        <label htmlFor="link">Or paste the pair link</label>
        <input id="link" value={text} onChange={(e) => setText(e.target.value)} placeholder="opnduck://pair?… or https://…#p=…" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
        <button className="ghost" disabled={busy || !text.trim()} onClick={() => void submit(text)}>
          {busy ? 'Pairing…' : 'Pair'}
        </button>
        <div className={`msg ${msg ? 'bad' : ''}`}>{msg}</div>
      </div>
      {scan && <QrScanner onResult={onScan} onClose={() => setScan(false)} />}
    </>
  )
}

function Send({ host, deviceName, shared, onUsed, onSent }: { host: Host; deviceName: string; shared: string; onUsed: () => void; onSent: () => void }) {
  const [text, setText] = useState('')
  const [preset, setPreset] = useState<PresetId>((store.get('preset') as PresetId) || 'smart')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const sendNow = useRef<(t: string) => void>(() => {})
  sendNow.current = async (t: string) => {
    setBusy(true)
    setMsg(null)
    try {
      const r = await sendTo(host, t, preset, deviceName)
      setMsg({ ok: true, text: r.via === 'engine' ? `Sent to ${host.name}. It is in the queue.` : r.via === 'direct' ? `Sent to ${host.name} directly.` : 'Sent through the relay. It arrives when OPNduck is running.' })
      setText('')
      onSent()
    } catch (e) {
      setMsg({ ok: false, text: errText(e) })
    } finally {
      setBusy(false)
    }
  }
  // A link shared from another app is sent at once, like the phone web page does.
  useEffect(() => {
    if (!shared) return
    const url = linkIn(shared)
    onUsed()
    if (url) {
      setText(url)
      sendNow.current(url)
    } else setMsg({ ok: false, text: 'There is no web link in what was shared.' })
  }, [shared, onUsed])
  return (
    <>
      <div>
        <h1>Send to {host.name}</h1>
        <p>Paste a link, or use Share → OPNduck in another app.</p>
      </div>
      <div className="panel">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="https://…" inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false} aria-label="Link to send" />
        {host.engine && (
          <>
            <label htmlFor="preset">Format</label>
            <select
              id="preset"
              value={preset}
              onChange={(e) => {
                setPreset(e.target.value as PresetId)
                store.set('preset', e.target.value)
              }}
            >
              {PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </>
        )}
        <div className="row">
          <button
            className="ghost"
            onClick={async () => {
              try {
                setText((await navigator.clipboard.readText()).trim())
              } catch {
                setMsg({ ok: false, text: 'Allow pasting, or paste into the box.' })
              }
            }}
          >
            Paste
          </button>
          <button disabled={busy || !text.trim()} onClick={() => sendNow.current(text)}>
            {busy ? 'Sending…' : 'Send'}
          </button>
        </div>
        <div className={`msg ${msg ? (msg.ok ? 'ok' : 'bad') : ''}`} role="status">
          {msg?.text}
        </div>
      </div>
      {!host.engine && <p>This computer is paired for sending links only. To see jobs and download results here, also scan its "Share this PC's engine" code in Settings.</p>}
    </>
  )
}

const pct = (t: Task) => Math.round(Math.max(0, Math.min(1, t.progress)) * 100)

function Queue({ host, tasks, offline, onChange }: { host: Host; tasks: Task[]; offline: string; onChange: () => void }) {
  if (!host.engine) return <NeedEngine />
  return (
    <>
      <h1>Queue</h1>
      {offline && <div className="msg bad">{offline}</div>}
      {tasks.length === 0 && !offline && <p>Nothing is running. Send a link and it shows up here.</p>}
      {tasks.map((t) => (
        <div className="panel task" key={t.id}>
          <div className="top">
            <span className="label">{t.label}</span>
            <span className="tag">{t.status === 'queued' ? 'Waiting' : `${pct(t)}%`}</span>
          </div>
          <div className="bar">
            <i style={{ width: `${pct(t)}%` }} />
          </div>
          <div className="row">
            <small>{t.stage || t.kind}</small>
            <button className="ghost small" onClick={() => void engine.cancel(host, t.id).then(onChange)}>
              Cancel
            </button>
          </div>
        </div>
      ))}
    </>
  )
}

function Done({ host, tasks, offline, onChange }: { host: Host; tasks: Task[]; offline: string; onChange: () => void }) {
  const [msg, setMsg] = useState('')
  if (!host.engine) return <NeedEngine />
  async function download(t: Task) {
    setMsg('')
    try {
      const url = await engine.fileLink(host, t.id)
      const name = t.label.replace(/^https?:\/\//, '').replace(/[^\w.\- ]+/g, '_').slice(0, 80) || 'opnduck'
      await native.download({ url, fileName: `${name}${/\.\w{2,5}$/.test(name) ? '' : '.mp4'}` })
      setMsg('Downloading. Watch the notification; it lands in Downloads/OPNduck.')
    } catch (e) {
      setMsg(errText(e))
    }
  }
  return (
    <>
      <h1>Done</h1>
      {(offline || msg) && <div className={`msg ${offline ? 'bad' : 'ok'}`}>{offline || msg}</div>}
      {tasks.length === 0 && !offline && <p>Finished jobs show up here, ready to download to this phone.</p>}
      {[...tasks].reverse().map((t) => (
        <div className="panel task" key={t.id}>
          <div className="top">
            <span className="label">{t.label}</span>
            <span className={`tag ${t.status === 'done' ? '' : 'err'}`}>{t.status}</span>
          </div>
          {t.error && <small style={{ color: 'var(--bad)' }}>{t.error}</small>}
          <div className="row">
            {t.status === 'done' ? <button onClick={() => void download(t)}>Download to phone</button> : <button className="ghost" onClick={() => void engine.rerun(host, t.id).then(onChange)}>Run again</button>}
            <button className="ghost" onClick={() => void engine.remove(host, t.id).then(onChange)}>
              Remove
            </button>
          </div>
        </div>
      ))}
    </>
  )
}

const NeedEngine = () => (
  <>
    <h1>Not available</h1>
    <p>This computer is paired for sending links only. Scan its "Share this PC's engine" code in Settings to see jobs and download results here.</p>
  </>
)

function Settings({ hosts, deviceName, onDeviceName, onHosts, onPaired }: { hosts: Host[]; deviceName: string; onDeviceName: (n: string) => void; onHosts: (h: Host[]) => void; onPaired: (list: Host[], added: Host) => void }) {
  const [adding, setAdding] = useState(false)
  return (
    <>
      <h1>Settings</h1>
      <div className="panel">
        <label htmlFor="dn">This phone's name</label>
        <input id="dn" value={deviceName} maxLength={40} onChange={(e) => onDeviceName(e.target.value)} />
      </div>
      {hosts.map((h) => (
        <div className="panel" key={h.id}>
          <div className="top task">
            <span className="label">{h.name}</span>
          </div>
          <small>
            {h.engine ? `Jobs and downloads: ${new URL(h.engine.baseUrl).host}` : 'No job access'} · {h.send ? 'Send link channel' : 'No send channel'}
          </small>
          <button className="ghost" onClick={() => void removeHost(h.id).then(onHosts)}>
            Unpair
          </button>
        </div>
      ))}
      <button className="ghost" onClick={() => setAdding((v) => !v)}>
        {adding ? 'Close' : 'Pair another computer or add a channel'}
      </button>
      {adding && <Pair deviceName={deviceName} onPaired={(l, a) => (setAdding(false), onPaired(l, a))} />}
    </>
  )
}
