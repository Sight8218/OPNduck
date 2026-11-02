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
import { host, type InboxLink } from '../host'

const WHERE: Record<string, string> = { direct: 'directly', ntfy: 'through the relay' }

// @category: remote/inbox-banner
/** On Home, above the tool tiles: links other devices sent that are waiting for a click. Shows nothing when there are none. */
export default function InboxBanner() {
  const [links, setLinks] = useState<InboxLink[]>([])
  const [error, setError] = useState('')

  const refresh = useCallback(() => {
    void host.remote.state().then((s) => setLinks(s.enabled ? s.pending : []))
  }, [])

  useEffect(() => {
    refresh()
    return host.remote.onChange(refresh)
  }, [refresh])

  async function act(id: string, accept: boolean) {
    setError('')
    try {
      await (accept ? host.remote.accept(id) : host.remote.dismiss(id))
    } catch (e) {
      setError((e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']*': (Error: )?/, ''))
    }
    refresh()
  }

  if (!host.isDesktop || links.length === 0) return null
  return (
    <div className="glass mb-4 flex flex-col gap-2 rounded-3xl p-4" role="region" aria-label="Links from other devices">
      <span className="text-sm font-bold">
        {links.length === 1 ? 'A link was sent to OPNduck' : `${links.length} links were sent to OPNduck`}
      </span>
      {links.map((l) => (
        <div key={l.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-[var(--input-bg)] p-2">
          <div className="min-w-0 flex-1">
            <span className="block truncate text-sm" title={l.url}>
              {l.url}
            </span>
            <span className="block text-[11px] text-[var(--text-dim)]">
              {l.channel === 'opnduck' ? 'Opened from an opnduck:// link' : `From ${l.from}, ${WHERE[l.channel] ?? l.channel}`}
              {l.target !== 'download' ? ` · runs a recipe` : ''}
            </span>
          </div>
          <button type="button" className="glass-btn px-3 py-1 text-xs" onClick={() => void act(l.id, true)}>
            {l.target === 'download' ? 'Download' : 'Run'}
          </button>
          <button type="button" className="glass-btn px-3 py-1 text-xs" onClick={() => void act(l.id, false)}>
            Dismiss
          </button>
        </div>
      ))}
      {error && <span className="text-xs text-red-400">{error}</span>}
    </div>
  )
}
