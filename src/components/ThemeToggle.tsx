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


import { THEMES, type Theme } from '../themes/theme'
import type { ThemeSwitchOrigin } from '../themes/useTheme'

const THEME_LABELS: Record<Theme, { label: string; hint: string }> = {
  blarange: { label: 'Blarange', hint: 'Black + orange, matching the OPNduck site. Flat & clean. Default.' },
  monochrome: { label: 'Monochrome', hint: 'High-contrast black & white for readability.' },
  // Overwritten per-render below with the live Omarchy theme's actual name.
  omarchy: { label: 'Synced with Omarchy', hint: 'Mirrors your current Omarchy theme automatically.' },
}

export default function ThemeToggle({
  theme,
  onChange,
  omarchy,
}: {
  theme: Theme
  onChange: (t: Theme, origin?: ThemeSwitchOrigin) => void
  /** Live Omarchy theme info, or null when Omarchy isn't detected — see useTheme(). */
  omarchy: { label: string } | null
}) {
  // Only offered on Omarchy — everywhere else this card simply never appears.
  const themes = omarchy ? [...THEMES, 'omarchy' as const] : THEMES
  const labels: Record<Theme, { label: string; hint: string }> = omarchy
    ? { ...THEME_LABELS, omarchy: { ...THEME_LABELS.omarchy, hint: `Currently ${omarchy.label}.` } }
    : THEME_LABELS

  return (
    <div className="glass rounded-3xl p-5">
      <h2 className="mb-1 text-base font-bold">UI Theme</h2>
      <p className="mb-4 text-xs text-[var(--text-dim)]">
        Switch the whole interface between the two visual modes.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {themes.map((t) => {
          const active = theme === t
          return (
            <button
              key={t}
              type="button"
              onClick={(e) => onChange(t, { x: e.clientX, y: e.clientY })}
              className={`rounded-2xl border p-4 text-left transition-[background-color,border-color,transform,box-shadow] duration-300 ease-out ${
                active
                  ? 'theme-card-active border-[var(--input-border-focus)] bg-[var(--input-bg)]'
                  : 'border-[var(--glass-border)] bg-[var(--glass-bg)] hover:scale-[1.015] hover:border-[var(--glass-border-inner)] hover:bg-[var(--glass-bg-strong)] active:scale-[0.98]'
              }`}
            >
              <span className="text-sm font-bold">{labels[t].label}</span>
              <span className="mt-1 block text-xs leading-relaxed text-[var(--text-dim)]">
                {labels[t].hint}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}