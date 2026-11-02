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

import { useEffect, useState } from 'react'
import { host, type ServerEntry } from '../host'
import { FEATURE_KIND, getRunOn, setRunOn } from '../lib/runOn'
import GlassSelect from './GlassSelect'

// @category: servers/run-on-selector
/** In a tool card's header: "Run on: This PC / <server>". Shown only when a server is paired and the tool can run on one. */
export default function RunOnSelector({ featureId }: { featureId: string }) {
  const kind = FEATURE_KIND[featureId]
  const [servers, setServers] = useState<ServerEntry[]>([])
  const [defaultWhere, setDefaultWhere] = useState('local')
  const [value, setValue] = useState(() => (kind ? getRunOn(kind) : 'default'))

  useEffect(() => {
    if (!kind || !host.isDesktop) return
    const load = () =>
      void host.servers.list().then((r) => {
        setServers(r.servers)
        setDefaultWhere(r.defaults[kind] ?? 'local')
      })
    load()
    return host.servers.onChange(load)
  }, [kind])

  if (!kind || servers.length === 0) return null
  const name = (id: string) => (id === 'local' || id === 'ask' ? 'This PC' : (servers.find((s) => s.id === id)?.name ?? 'This PC'))
  const options = [
    { value: 'default', label: `Default (${name(defaultWhere)})` },
    { value: 'local', label: 'This PC' },
    ...servers.map((s) => ({ value: s.id, label: s.name })),
  ]
  // A server that was removed since the choice was saved falls back to the default.
  const shown = options.some((o) => o.value === value) ? value : 'default'
  return (
    <div className="flex shrink-0 items-center gap-2" title="Where this tool's jobs run. Change the default in Settings > Servers.">
      <span className="text-[11px] text-[var(--text-dim)]">Run on</span>
      <div className="w-52">
        <GlassSelect
          id={`run-on-${featureId}`}
          options={options}
          value={shown}
          onChange={(v) => {
            setRunOn(kind, v)
            setValue(v)
          }}
        />
      </div>
    </div>
  )
}
// --- end: servers/run-on-selector ---
