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
 * but WITHOUT ANY WARRANTY, without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

import { useEffect, useRef, useState } from 'react'
import type { Theme } from '../themes/theme'

// These are the Glass theme's own backdrop-gradient stops (see tokens.css
// --bg-base for [data-theme='glass']) — this tool exists to tune exactly
// that gradient, so it only makes sense, and only ever runs, while Glass
// is the active theme. Applying them regardless of theme was the bug: the
// override lands on <html> via inline style, which beats every theme
// selector, so it silently bled Glass's reddish palette into Flat/Monochrome
// too the moment any slider was touched.
const GRAD_STOPS = [0x2b1216, 0x1f0508, 0x34151a, 0x1f0508]

function mixBlack(hex: number, amount: number): number {
  const a = Math.max(0, Math.min(1, amount))
  const r = (hex >> 16) & 0xff
  const g = (hex >> 8) & 0xff
  const b = hex & 0xff
  const nr = Math.round(r * (1 - a))
  const ng = Math.round(g * (1 - a))
  const nb = Math.round(b * (1 - a))
  return (nr << 16) | (ng << 8) | nb
}

function hex(hex: number): string {
  return '#' + hex.toString(16).padStart(6, '0')
}

function ensureScrim(id: string): HTMLElement | null {
  let el = document.getElementById(id) as HTMLElement | null
  if (!el) {
    el = document.createElement('div')
    el.id = id
    el.style.position = 'fixed'
    el.style.inset = '0'
    el.style.zIndex = '-1'
    el.style.pointerEvents = 'none'
    document.body.appendChild(el)
  }
  return el
}

export default function GlassTune({ theme }: { theme: Theme }) {
  const [dark, setDark] = useState(33)
  const [scrim, setScrim] = useState(20)
  const [blob, setBlob] = useState(-47)
  const [opacity, setOpacity] = useState(65)
  const first = useRef(true)
  const isGlass = theme === 'glass'

  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    if (!isGlass) return
    const d = Math.max(0, Math.min(100, dark))
    const s = Math.max(0, Math.min(95, scrim))
    const bl = Math.max(-60, Math.min(60, blob))
    const a = Math.max(10, Math.min(98, opacity))
    // Darken the backdrop gradient toward black.
    const stops = GRAD_STOPS.map((s2) => mixBlack(s2, d / 100))
    document.documentElement.style.setProperty(
      '--bg-base',
      `linear-gradient(180deg, ${hex(stops[0])} 0%, ${hex(stops[1])} 48%, ${hex(stops[2])} 78%, ${hex(stops[3])} 100%)`,
    )
    // Blob (fluid) brightness: -60..+60 -> blob layer opacity 0.15..0.9.
    const blobAlpha = Math.round((0.15 + ((bl + 60) / 120) * 0.75) * 100) / 100
    document.querySelectorAll<HTMLElement>('.fluid-blob').forEach((el) => {
      el.style.opacity = blobAlpha.toString()
    })
    // Panel opacity (glass surfaces).
    document.documentElement.style.setProperty('--glass-bg', `rgba(69, 39, 42, ${a / 100})`)
    // Scrim over the backdrop.
    const el = ensureScrim('glass-tune-scrim')
    if (el) el.style.backgroundColor = s > 0 ? `rgba(0,0,0,${s / 100})` : 'transparent'
  }, [dark, scrim, blob, opacity, isGlass])

  // Switched away from Glass (or this panel unmounts while it was applied):
  // clear every override so nothing lingers into whatever theme comes next.
  useEffect(() => {
    if (isGlass) return
    document.documentElement.style.removeProperty('--bg-base')
    document.documentElement.style.removeProperty('--glass-bg')
    const el = document.getElementById('glass-tune-scrim')
    el?.remove()
  }, [isGlass])

  useEffect(() => {
    return () => {
      document.documentElement.style.removeProperty('--bg-base')
      document.documentElement.style.removeProperty('--glass-bg')
      document.getElementById('glass-tune-scrim')?.remove()
    }
  }, [])

  const code = `dark:${dark},scrim:${scrim},blob:${blob},panels:${opacity}`

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
    } catch {
      /* clipboard may be blocked — user can copy manually */
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-4">
      <span className="text-sm font-semibold text-[var(--text)]">TEMP: Backdrop tuning</span>
      {!isGlass && (
        <p className="text-xs text-[var(--text-faint)]">
          Only tunes the Glass theme's backdrop — switch to Glass to use these.
        </p>
      )}
      <label className="flex flex-col gap-1 text-xs text-[var(--text-dim)]" aria-disabled={!isGlass}>
        Backdrop darkness (black {dark}%)
        <input
          type="range"
          min={0}
          max={100}
          value={dark}
          disabled={!isGlass}
          onChange={(e) => setDark(Number(e.target.value))}
          className="disabled:opacity-40"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-[var(--text-dim)]" aria-disabled={!isGlass}>
        Backdrop scrim (dims it {scrim}%)
        <input
          type="range"
          min={0}
          max={95}
          value={scrim}
          disabled={!isGlass}
          onChange={(e) => setScrim(Number(e.target.value))}
          className="disabled:opacity-40"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-[var(--text-dim)]" aria-disabled={!isGlass}>
        Blob brightness ({blob > 0 ? '+' : ''}{blob})
        <input
          type="range"
          min={-60}
          max={60}
          value={blob}
          disabled={!isGlass}
          onChange={(e) => setBlob(Number(e.target.value))}
          className="disabled:opacity-40"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-[var(--text-dim)]" aria-disabled={!isGlass}>
        Panel opacity (opaque {opacity}%)
        <input
          type="range"
          min={10}
          max={98}
          value={opacity}
          disabled={!isGlass}
          onChange={(e) => setOpacity(Number(e.target.value))}
          className="disabled:opacity-40"
        />
      </label>
      <div className="flex items-center gap-2">
        <code className="flex-1 truncate rounded-md bg-black/40 px-2 py-1 font-mono text-xs text-[var(--text)]">{code}</code>
        <button
          type="button"
          onClick={copy}
          className="rounded-md border border-[var(--input-border)] bg-[var(--btn-bg)] px-2 py-1 text-xs font-semibold text-[var(--btn-text)]"
        >
          Copy
        </button>
      </div>
    </div>
  )
}