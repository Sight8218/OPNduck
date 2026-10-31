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


import { applyOmarchyTokens, clearOmarchyTokens } from './omarchySync'
import { OMARCHY_PALETTES } from './omarchyPalettes'

/** 'omarchy' mirrors the Linux desktop's live Omarchy theme — see
 *  themes/omarchySync.ts. It's only ever offered when Omarchy is detected
 *  (ThemeToggle), but is a valid stored value so a prior choice survives
 *  even before that detection resolves on a fresh launch. */
/** `palette:<slug>` = one of the bundled Omarchy palettes (omarchyPalettes.ts), usable on any OS. */
export type Theme = 'blarange' | 'monochrome' | 'omarchy' | `palette:${string}`

const paletteSlug = (t: string): string | null => (t.startsWith('palette:') && Object.hasOwn(OMARCHY_PALETTES, t.slice(8)) ? t.slice(8) : null)

/** Every valid stored value, including the conditionally-shown one — used
 *  only to validate localStorage, never to decide what to render. */
const ALL_THEMES: Theme[] = ['blarange', 'monochrome', 'omarchy']

const STORAGE_KEY = 'opnduck.theme'

export function applyTheme(theme: Theme): void {
  if (typeof document !== 'undefined') {
    const slug = paletteSlug(theme)
    if (slug) {
      // Bundled Omarchy palettes share the Omarchy look (square corners etc.), with their own fixed colors.
      document.documentElement.setAttribute('data-theme', 'omarchy')
      applyOmarchyTokens({ slug, colors: OMARCHY_PALETTES[slug] })
    } else {
    document.documentElement.setAttribute('data-theme', theme)
    // 'omarchy' needs live color data to render, applied separately by
    // useTheme.ts — but switching AWAY from it must clear any inline
    // tokens left over, or they'd keep overriding Blarange/Monochrome's
    // own stylesheet values (inline style always wins).
    if (theme !== 'omarchy') clearOmarchyTokens()
    }
  }
  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    /* storage unavailable — theme just won't persist */
  }
}

export function readStoredTheme(): Theme {
  if (typeof window === 'undefined') return 'blarange'
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored && ((ALL_THEMES as string[]).includes(stored) || paletteSlug(stored))) return stored as Theme
  } catch {
    /* fall through to default */
  }
  return 'blarange'
}
