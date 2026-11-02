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

/** A running plugin that fills a Home slot (manifest \`ui.slot\`): "selector" replaces the tile row, "stage" surrounds the open tool. */
export interface SlotPlugin {
  pluginId: string
  name: string
  version: string
  entry: string
}
export type SlotName = 'selector' | 'stage'

const current: Record<SlotName, SlotPlugin | null> = { selector: null, stage: null }
const listeners = new Set<() => void>()

/** Called by the plugin loader. The first plugin of a slot wins; null puts the normal Home back. */
export function setSlotPlugin(slot: SlotName, next: SlotPlugin | null): void {
  const prev = current[slot]
  if (prev?.pluginId === next?.pluginId && prev?.version === next?.version) return
  current[slot] = next
  for (const l of listeners) l()
}

export function useSlotPlugin(slot: SlotName): SlotPlugin | null {
  return useSyncExternalStore(
    (cb) => (listeners.add(cb), () => listeners.delete(cb)),
    () => current[slot],
  )
}
