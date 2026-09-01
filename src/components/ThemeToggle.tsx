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

const THEME_LABELS: Record<Theme, { label: string; hint: string }> = {
  glass: { label: 'Glass', hint: 'Premium frosted look over the fluid gradient. Default.' },
  flat: { label: 'Flat', hint: 'Solid, fast, no transparency — saves resources.' },
  monochrome: { label: 'Monochrome', hint: 'High-contrast black & white for readability.' },
}

export default function ThemeToggle({
  theme,
  onChange,
}: {
  theme: Theme
  onChange: (t: Theme) => void
}) {
  return (
    <div className="glass rounded-3xl p-5">
      <h2 className="mb-1 text-base font-bold">UI Theme</h2>
      <p className="mb-4 text-xs text-[var(--text-dim)]">
        Switch the whole interface between the three visual modes.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {THEMES.map((t) => {
          const active = theme === t
          return (
            <button
              key={t}
              type="button"
              onClick={() => onChange(t)}
              className={`rounded-2xl border p-4 text-left transition-colors ${
                active
                  ? 'border-[var(--input-border-focus)] bg-[var(--input-bg)]'
                  : 'border-[var(--glass-border)] bg-[var(--glass-bg)]'
              }`}
            >
              <span className="text-sm font-bold">{THEME_LABELS[t].label}</span>
              <span className="mt-1 block text-xs leading-relaxed text-[var(--text-dim)]">
                {THEME_LABELS[t].hint}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}