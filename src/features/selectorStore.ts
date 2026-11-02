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
import { useSyncExternalStore } from 'react'

/** A running plugin whose card replaces the tile row on Home (manifest `ui.slot: "selector"`). */
export interface SelectorPlugin {
  pluginId: string
  name: string
  version: string
  entry: string
}

let current: SelectorPlugin | null = null
const listeners = new Set<() => void>()

/** Called by the plugin loader. The first selector plugin wins; null puts the normal tiles back. */
export function setSelectorPlugin(next: SelectorPlugin | null): void {
  const same = current?.pluginId === next?.pluginId && current?.version === next?.version
  if (same) return
  current = next
  for (const l of listeners) l()
}

export function useSelectorPlugin(): SelectorPlugin | null {
  return useSyncExternalStore(
    (cb) => (listeners.add(cb), () => listeners.delete(cb)),
    () => current,
  )
}
