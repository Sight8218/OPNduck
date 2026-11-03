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

import { OMARCHY_PALETTES } from './omarchyPalettes'
import type { Theme } from './theme'

/** Colour words and the hue range (degrees) of a theme's accent that counts as that colour. */
const HUES: Record<string, [number, number]> = { red: [345, 15], orange: [15, 45], yellow: [45, 70], green: [70, 170], teal: [160, 195], cyan: [170, 200], blue: [200, 255], purple: [255, 300], pink: [300, 345] }

function hueOf(hex: string): { h: number; s: number } {
  const n = hex.replace('#', '')
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  if (d === 0) return { h: 0, s: 0 }
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return { h: (h * 60 + 360) % 360, s: d / (1 - Math.abs(max + min - 1) || 1) }
}

/** A theme for a name ("osaka-jade", "Monochrome") or a colour word ("green"); null when nothing fits. The most colourful match wins for a colour. */
export function resolveTheme(wanted: string): { theme: Theme; label: string } | null {
  const w = wanted.trim().toLowerCase().replace(/\s+/g, '-')
  if (['blarange', 'monochrome'].includes(w)) return { theme: w as Theme, label: w }
  if (['black-and-white', 'grey', 'gray', 'black'].includes(w)) return { theme: 'monochrome', label: 'monochrome' }
  if (Object.hasOwn(OMARCHY_PALETTES, w)) return { theme: `palette:${w}` as Theme, label: w }
  const range = HUES[w]
  if (!range) return null
  const [lo, hi] = range
  let best: { slug: string; s: number } | null = null
  for (const [slug, colors] of Object.entries(OMARCHY_PALETTES)) {
    if (!colors.accent) continue
    const { h, s } = hueOf(colors.accent)
    const inside = lo <= hi ? h >= lo && h < hi : h >= lo || h < hi
    if (inside && s > 0.15 && (!best || s > best.s)) best = { slug, s }
  }
  if (w === 'orange') return { theme: 'blarange', label: 'blarange' }
  return best ? { theme: `palette:${best.slug}` as Theme, label: best.slug } : null
}
