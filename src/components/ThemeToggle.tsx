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


import { OMARCHY_PALETTES } from '../themes/omarchyPalettes'
import { omarchySlugToLabel } from '../themes/omarchySync'
import type { Theme } from '../themes/theme'

/** Added in Omarchy 4.5 (rc2): flagged in the picker. */
const NEW_IN_45 = new Set(['jade-horse', 'starship'])
import type { ThemeSwitchOrigin } from '../themes/useTheme'

interface Swatches {
  background: string
  colors: string[]
}

/** Preview strips for the three built-in options (the Omarchy palettes read theirs from their own colors). */
const MAIN_SWATCHES: Record<'blarange' | 'monochrome', Swatches> = {
  blarange: { background: '#17130f', colors: ['#e1892f', '#f0a63b', '#ede6d9', '#a8998a', '#4a3b2b', '#6b5439'] },
  monochrome: { background: '#141414', colors: ['#e8e8e8', '#ffffff', '#f4f4f4', '#9a9a9a', '#4a4a4a', '#6e6e6e'] },
}

const paletteSwatches = (c: Record<string, string>): Swatches => ({
  background: c.background,
  colors: [c.accent, c.foreground, c.red, c.green, c.blue, c.yellow],
})

/** One theme as a swatch card: the same look for the built-in themes and every Omarchy palette. */
function ThemeCard({
  label,
  hint,
  swatches,
  active,
  isNew,
  onPick,
}: {
  label: string
  hint?: string
  swatches: Swatches
  active: boolean
  isNew?: boolean
  onPick: (e: React.MouseEvent) => void
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={active}
      title={hint ? `${label} — ${hint}` : label}
      className={`flex flex-col gap-2 rounded-xl border p-2.5 text-left transition-[border-color,transform] duration-200 ${
        active ? 'border-[var(--input-border-focus)] bg-[var(--input-bg)]' : 'border-[var(--glass-border)] bg-[var(--glass-bg)] hover:scale-[1.02] hover:border-[var(--glass-border-inner)]'
      }`}
    >
      <span className="flex h-8 w-full items-center gap-1 rounded-md px-1.5" style={{ background: swatches.background }}>
        {swatches.colors.map((col, i) => (
          <span key={i} className="h-3.5 flex-1 rounded-sm" style={{ background: col }} />
        ))}
      </span>
      <span className="flex items-center justify-between gap-2 text-xs font-medium">
        <span className="truncate">{label}</span>
        {isNew && <span className="rounded bg-[var(--accent-soft)] px-1 text-[10px] text-[var(--accent)]">new</span>}
      </span>
      {hint && <span className="-mt-1 text-[10px] leading-snug text-[var(--text-dim)]">{hint}</span>}
    </button>
  )
}

export default function ThemeToggle({
  theme,
  onChange,
  omarchy,
}: {
  theme: Theme
  onChange: (t: Theme, origin?: ThemeSwitchOrigin) => void
  /** Live Omarchy theme info, or null when Omarchy isn't detected — see useTheme(). */
  omarchy: { label: string; slug: string } | null
}) {
  const pick = (t: Theme) => (e: React.MouseEvent) => onChange(t, { x: e.clientX, y: e.clientY })
  const live = omarchy && OMARCHY_PALETTES[omarchy.slug] ? paletteSwatches(OMARCHY_PALETTES[omarchy.slug]) : { background: '#1a1a1a', colors: ['#888', '#aaa', '#ccc', '#999', '#777', '#bbb'] }

  return (
    <div className="glass rounded-3xl p-5">
      <h2 className="mb-1 text-base font-bold">UI Theme</h2>
      <p className="mb-3 text-xs text-[var(--text-dim)]">Pick a look for the whole interface. Your choice is remembered.</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <ThemeCard label="Blarange" hint="Black + orange. Default." swatches={MAIN_SWATCHES.blarange} active={theme === 'blarange'} onPick={pick('blarange')} />
        <ThemeCard label="Monochrome" hint="High-contrast black & white." swatches={MAIN_SWATCHES.monochrome} active={theme === 'monochrome'} onPick={pick('monochrome')} />
        {omarchy && (
          <ThemeCard
            label="Synced with Omarchy"
            hint={`Follows your live theme (${omarchy.label}).`}
            swatches={live}
            active={theme === 'omarchy'}
            onPick={pick('omarchy')}
          />
        )}
      </div>

      <h3 className="mb-1 mt-6 text-sm font-bold">Omarchy themes</h3>
      <p className="mb-3 text-xs text-[var(--text-dim)]">
        All {Object.keys(OMARCHY_PALETTES).length} themes from Omarchy 4.5 plus the classics that were dropped (Osaka Jade), built in, so you can use them on any system
        (Omarchy not required).
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {Object.entries(OMARCHY_PALETTES).map(([slug, c]) => (
          <ThemeCard
            key={slug}
            label={omarchySlugToLabel(slug)}
            swatches={paletteSwatches(c)}
            active={theme === `palette:${slug}`}
            isNew={NEW_IN_45.has(slug)}
            onPick={pick(`palette:${slug}` as Theme)}
          />
        ))}
      </div>
    </div>
  )
}
