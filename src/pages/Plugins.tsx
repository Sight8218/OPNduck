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
import { IconArrowRight } from '@tabler/icons-react'
import { host, type PluginStatus, type PluginStoreEntry, type PluginStoreList, type PluginSummary } from '../host'
import type { PluginPermission } from '../features/registry'
import { OFF_BY_DEFAULT, permissionInfo } from '../features/pluginPermissions'
import Tag from '../components/Tag'
import PluginSafeMode from '../components/PluginSafeMode'

const GUIDE_URL = 'https://github.com/Sight8218/OPNduck/blob/main/PLUGINS.md'

const STATUS_LABEL: Record<PluginStatus, string> = {
  broken: 'Broken',
  disabled: 'Off',
  'needs-approval': 'Needs approval',
  'safe-mode': 'Paused (safe mode)',
  starting: 'Starting…',
  running: 'On',
  crashed: 'Crashed',
}

type Tab = 'installed' | 'store'

export default function Plugins() {
  const [tab, setTab] = useState<Tab>('installed')
  const plugins = host.plugins

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <h1 className="mb-1 text-2xl font-extrabold sm:text-3xl">Plugins</h1>
      <p className="mb-4 text-sm text-[var(--text-dim)]">
        Add cards and tools to OPNduck. A plugin is code that runs on your computer, so only turn on ones you trust.{' '}
        <a href={GUIDE_URL} target="_blank" rel="noreferrer" className="font-semibold text-[var(--accent)] underline underline-offset-2">
          Write your own <IconArrowRight size={13} className="inline" aria-hidden="true" />
        </a>
      </p>

      {!plugins ? (
        <div className="glass rounded-3xl p-8 text-center text-sm text-[var(--text-dim)]">
          Plugins need the desktop app. Open OPNduck on your computer to install and manage them.
        </div>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap gap-2" role="tablist">
            {(['installed', 'store'] as Tab[]).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                className={`glass-btn ${tab === t ? 'ring-1 ring-[var(--accent)]' : ''}`}
                onClick={() => setTab(t)}
              >
                {t === 'installed' ? 'Installed' : 'Store'}
              </button>
            ))}
          </div>
          {tab === 'installed' ? (
            <Installed />
          ) : (
            <Store onInstalled={() => setTab('installed')} />
          )}
        </>
      )}
    </div>
  )
}

function Store({ onInstalled }: { onInstalled: () => void }) {
  const plugins = host.plugins!
  const [data, setData] = useState<PluginStoreList | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(
    async (force: boolean) => {
      try {
        setData(await plugins.storeList(force))
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    },
    [plugins],
  )
  useEffect(() => {
    void load(false)
    return plugins.onChanged(() => void load(false))
  }, [plugins, load])

  const verified = data?.entries.filter((e) => e.verified) ?? []
  const community = data?.entries.filter((e) => !e.verified) ?? []
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <button type="button" className="glass-btn" onClick={() => void load(true)}>
          Refresh
        </button>
        {data?.fetchedAt ? <span className="text-[11px] text-[var(--text-faint)]">Updated {new Date(data.fetchedAt).toLocaleString()}</span> : null}
      </div>
      {data?.offline && (
        <p className="text-xs text-[var(--text-dim)]">
          Could not reach the store{data.error ? ` (${data.error})` : ''}. {data.entries.length ? 'Showing the last saved list.' : 'Nothing saved yet.'}
        </p>
      )}
      {error && <p className="text-xs text-red-400">{error}</p>}
      {data && data.entries.length === 0 && !data.offline && (
        <div className="glass rounded-3xl p-8 text-center text-sm text-[var(--text-dim)]">The store has no plugins yet.</div>
      )}
      {verified.length > 0 && <h2 className="mt-1 text-sm font-bold">Verified</h2>}
      {verified.map((e) => (
        <StoreRow key={e.id} entry={e} onInstalled={onInstalled} onError={setError} />
      ))}
      {community.length > 0 && <h2 className="mt-1 text-sm font-bold">Community (unverified)</h2>}
      {community.map((e) => (
        <StoreRow key={e.id} entry={e} onInstalled={onInstalled} onError={setError} />
      ))}
    </div>
  )
}

function StoreRow({ entry, onInstalled, onError }: { entry: PluginStoreEntry; onInstalled: () => void; onError: (message: string) => void }) {
  const plugins = host.plugins!
  const [confirming, setConfirming] = useState(false)
  const [understood, setUnderstood] = useState(false)
  const [busy, setBusy] = useState(false)

  const fromFolder = entry.installed !== '' && entry.installedFrom !== 'store'
  const upToDate = entry.installed === entry.version
  const label = entry.installed ? 'Update' : 'Install'

  async function install() {
    setBusy(true)
    onError('')
    try {
      await plugins.storeInstall(entry.id)
      setConfirming(false)
      onInstalled()
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="glass rounded-3xl p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-bold">{entry.name}</h3>
            <span className="text-[11px] text-[var(--text-faint)]">v{entry.version}</span>
            <Tag>{entry.verified ? 'Verified' : 'Unverified'}</Tag>
            {entry.installed && <Tag>{upToDate ? 'Installed' : `Installed v${entry.installed}`}</Tag>}
          </div>
          <p className="mt-1 text-xs text-[var(--text-dim)]">
            {entry.description} <span className="text-[var(--text-faint)]">by {entry.author}</span>
          </p>
          <p className="mt-1 text-[11px] text-[var(--text-faint)]">
            Asks for: {entry.permissions.length ? entry.permissions.map((p) => permissionInfo(p).label).join(', ') : 'nothing'}
            {entry.network.length > 0 && ` (sites: ${entry.network.join(', ')})`}
          </p>
          <a href={entry.repo} target="_blank" rel="noreferrer" className="text-[11px] text-[var(--accent)] underline underline-offset-2">
            Inspect the code
          </a>
        </div>
        <div className="flex gap-2">
          {fromFolder ? (
            <span className="text-[11px] text-[var(--text-faint)]">Already installed from a folder</span>
          ) : !upToDate && !confirming ? (
            <button type="button" className="glass-btn" disabled={busy} onClick={() => (entry.verified ? void install() : setConfirming(true))}>
              {busy ? 'Installing…' : label}
            </button>
          ) : null}
        </div>
      </div>
      {confirming && (
        <div className="mt-3 flex flex-col gap-2 border-t border-[var(--glass-border)] pt-3">
          <p className="rounded-lg bg-[var(--input-bg)] p-2 text-xs text-red-400">
            This plugin is not verified. OPNduck takes no responsibility for what it does. Its code was not reviewed, so read it on GitHub before you install it.
          </p>
          <label className="flex cursor-pointer items-start gap-3 py-1">
            <input type="checkbox" className="mt-0.5 accent-[var(--accent)]" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
            <span className="text-sm font-medium">I understand and want to download it</span>
          </label>
          <div className="flex gap-2">
            <button type="button" className="glass-btn" disabled={busy || !understood} onClick={() => void install()}>
              {busy ? 'Installing…' : label}
            </button>
            <button type="button" className="glass-btn" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function Installed() {
  const plugins = host.plugins!
  const [list, setList] = useState<PluginSummary[] | null>(null)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    try {
      setList(await plugins.list())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [plugins])

  useEffect(() => {
    void refresh()
    return plugins.onChanged(() => void refresh())
  }, [plugins, refresh])

  async function rescan() {
    setError('')
    try {
      setList(await plugins.rescan())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="glass-btn" onClick={() => void plugins.openFolder()}>
          Open plugins folder
        </button>
        <button type="button" className="glass-btn" onClick={() => void rescan()}>
          Rescan
        </button>
      </div>
      <PluginSafeMode />
      {error && <p className="text-xs text-red-400">{error}</p>}
      {list === null ? null : list.length === 0 ? (
        <div className="glass rounded-3xl p-8 text-center text-sm text-[var(--text-dim)]">
          No plugins installed. Put a plugin folder in the plugins folder, then press Rescan.
        </div>
      ) : (
        list.map((p) => <PluginRow key={p.id} plugin={p} onError={setError} />)
      )}
    </div>
  )
}

function PluginRow({ plugin, onError }: { plugin: PluginSummary; onError: (message: string) => void }) {
  const plugins = host.plugins!
  const m = plugin.manifest
  const asked = m?.permissions ?? []
  const [reviewing, setReviewing] = useState(false)
  const [picked, setPicked] = useState<PluginPermission[]>([])
  const [understood, setUnderstood] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [busy, setBusy] = useState(false)

  const on = plugin.enabled
  // Ask only about what the user has not been shown; already-approved ones stay as they are.
  const toReview = plugin.pendingApproval.length > 0 ? plugin.pendingApproval : asked.filter((p) => !plugin.approved.includes(p))

  function startReview() {
    const base = plugin.pendingApproval.length > 0 ? plugin.approved : []
    setPicked([...base, ...toReview.filter((p) => !OFF_BY_DEFAULT.includes(p))])
    setUnderstood(false)
    setReviewing(true)
  }

  async function run(action: () => Promise<unknown>) {
    setBusy(true)
    onError('')
    try {
      await action()
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function approve() {
    await run(() => plugins.enable(plugin.id, picked))
    setReviewing(false)
  }

  function toggle(p: PluginPermission, checked: boolean) {
    setPicked((cur) => (checked ? [...cur, p] : cur.filter((x) => x !== p)))
  }

  const canApprove = plugin.verified || understood

  return (
    <div className="glass rounded-3xl p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-bold">{m?.name ?? plugin.id}</h2>
            {m && <span className="text-[11px] text-[var(--text-faint)]">v{m.version}</span>}
            <Tag>{plugin.verified ? 'Verified' : 'Unverified'}</Tag>
            <Tag>{STATUS_LABEL[plugin.status]}</Tag>
          </div>
          {m && (
            <p className="mt-1 text-xs text-[var(--text-dim)]">
              {m.description} <span className="text-[var(--text-faint)]">by {m.author}</span>
            </p>
          )}
          {m?.repo && (
            <a href={m.repo} target="_blank" rel="noreferrer" className="text-[11px] text-[var(--accent)] underline underline-offset-2">
              Inspect the code
            </a>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {plugin.status !== 'broken' && !on && !reviewing && (
            <button type="button" className="glass-btn" disabled={busy} onClick={startReview}>
              {plugin.status === 'needs-approval' ? 'Review and turn on' : 'Turn on'}
            </button>
          )}
          {on && (
            <button type="button" className="glass-btn" disabled={busy} onClick={() => void run(() => plugins.disable(plugin.id))}>
              Turn off
            </button>
          )}
          {!confirmRemove ? (
            <button type="button" className="glass-btn" disabled={busy} onClick={() => setConfirmRemove(true)}>
              Remove
            </button>
          ) : (
            <>
              <button
                type="button"
                className="glass-btn text-red-400"
                disabled={busy}
                onClick={() => void run(() => plugins.remove(plugin.id))}
              >
                Delete its folder
              </button>
              <button type="button" className="glass-btn" onClick={() => setConfirmRemove(false)}>
                Keep
              </button>
            </>
          )}
        </div>
      </div>

      {plugin.errors.length > 0 && (
        <ul className="mt-2 list-disc pl-5 text-xs text-red-400">
          {plugin.errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      {plugin.lastError && !plugin.errors.includes(plugin.lastError) && (
        <p className="mt-2 text-xs text-red-400">Last error: {plugin.lastError}</p>
      )}
      {plugin.status === 'needs-approval' && !reviewing && (
        <p className="mt-2 text-xs text-[var(--text-dim)]">An update asks for new permissions. It stays off until you review them.</p>
      )}

      {on && asked.length > 0 && (
        <p className="mt-2 text-[11px] text-[var(--text-faint)]">
          Allowed: {plugin.approved.length ? plugin.approved.map((p) => permissionInfo(p).label).join(', ') : 'nothing'}
        </p>
      )}

      {reviewing && (
        <div className="mt-3 flex flex-col gap-2 border-t border-[var(--glass-border)] pt-3">
          {!plugin.verified && (
            <p className="rounded-lg bg-[var(--input-bg)] p-2 text-xs text-red-400">
              This plugin is not verified. OPNduck takes no responsibility for what it does. It runs code on your computer, so look at its code first.
            </p>
          )}
          {toReview.length === 0 ? (
            <p className="text-xs text-[var(--text-dim)]">This plugin asks for no permissions. It can show a card and nothing else.</p>
          ) : (
            <>
              <span className="text-xs text-[var(--text-dim)]">Choose what it may do. You can allow only some of these:</span>
              {toReview.map((p) => {
                const info = permissionInfo(p)
                return (
                  <label key={p} className="flex cursor-pointer items-start gap-3 py-1">
                    <input
                      type="checkbox"
                      className="mt-0.5 accent-[var(--accent)]"
                      checked={picked.includes(p)}
                      onChange={(e) => toggle(p, e.target.checked)}
                    />
                    <span>
                      <span className={`text-sm font-medium ${info.risk === 'high' ? 'text-red-400' : ''}`}>{info.label}</span>
                      <span className="block text-[11px] text-[var(--text-dim)]">{info.detail}</span>
                      {p === 'network' && m?.network && m.network.length > 0 && (
                        <span className="block text-[11px] text-[var(--text-faint)]">Sites: {m.network.join(', ')}</span>
                      )}
                    </span>
                  </label>
                )
              })}
            </>
          )}
          {!plugin.verified && (
            <label className="flex cursor-pointer items-start gap-3 py-1">
              <input type="checkbox" className="mt-0.5 accent-[var(--accent)]" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
              <span className="text-sm font-medium">I understand and want to turn it on</span>
            </label>
          )}
          <div className="flex gap-2">
            <button type="button" className="glass-btn" disabled={busy || !canApprove} onClick={() => void approve()}>
              Turn on
            </button>
            <button type="button" className="glass-btn" onClick={() => setReviewing(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
