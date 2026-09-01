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


export type Theme = 'glass' | 'flat' | 'monochrome'

export const THEMES: Theme[] = ['glass', 'flat', 'monochrome']

const STORAGE_KEY = 'opnduck.theme'

export function applyTheme(theme: Theme): void {
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', theme)
  }
  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    /* storage unavailable — theme just won't persist */
  }
}

export function readStoredTheme(): Theme {
  if (typeof window === 'undefined') return 'glass'
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored && (THEMES as string[]).includes(stored)) return stored as Theme
  } catch {
    /* fall through to default */
  }
  return 'glass'
}
