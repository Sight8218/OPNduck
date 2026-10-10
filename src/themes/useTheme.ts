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


import { useCallback, useEffect, useState } from 'react'
import { flushSync } from 'react-dom'
import { host } from '../host'
import { applyTheme, readStoredTheme, type Theme } from './theme'
import { applyOmarchyTokens, omarchySlugToLabel, type OmarchyTheme } from './omarchySync'

type ViewTransitionDocument = Document & {
  startViewTransition?: (callback: () => void) => { ready: Promise<void> }
}

/** Where on screen the switch was triggered from — the circle-wipe
 *  animation expands outward from this point. Defaults to viewport center. */
export type ThemeSwitchOrigin = { x: number; y: number }

/**
 * React bindings for the OPNduck theme engine.
 * Applies `data-theme` to <html> and persists the choice to localStorage.
 * Also tracks the live Omarchy theme (if the host can see one) so the
 * "Synced with Omarchy" option can appear/update in ThemeToggle and, when
 * selected, mirror Omarchy's own theme changes in real time.
 */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => readStoredTheme())
  const [omarchyTheme, setOmarchyTheme] = useState<OmarchyTheme | null>(null)

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  // Track the live Omarchy theme regardless of which theme is currently
  // selected — ThemeToggle needs it to decide whether to show the option
  // at all, and to label it with the theme's real name.
  useEffect(() => {
    if (!host.omarchy) return
    let cancelled = false
    host.omarchy.get().then((t) => {
      if (!cancelled) setOmarchyTheme(t)
    })
    const unsubscribe = host.omarchy.subscribe((t) => setOmarchyTheme(t))
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  // While 'omarchy' is the active theme, keep the injected tokens in sync
  // with whatever Omarchy theme is currently live.
  useEffect(() => {
    if (theme === 'omarchy' && omarchyTheme) applyOmarchyTokens(omarchyTheme)
  }, [theme, omarchyTheme])

  const switchTheme = useCallback((next: Theme, origin?: ThemeSwitchOrigin) => {
    const doc = document as ViewTransitionDocument
    const reduceMotion =
      window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
      document.documentElement.hasAttribute('data-reduce-motion')

    if (!doc.startViewTransition || reduceMotion) {
      setTheme(next)
      return
    }

    const root = document.documentElement
    root.style.setProperty('--theme-origin-x', `${origin?.x ?? window.innerWidth / 2}px`)
    root.style.setProperty('--theme-origin-y', `${origin?.y ?? window.innerHeight / 2}px`)

    // Furthest viewport corner from the origin, so the wipe fully covers
    // the screen no matter where the click landed.
    const dx = Math.max(origin?.x ?? 0, window.innerWidth - (origin?.x ?? 0))
    const dy = Math.max(origin?.y ?? 0, window.innerHeight - (origin?.y ?? 0))
    const radius = Math.hypot(dx, dy)
    root.style.setProperty('--theme-reveal-radius', `${radius}px`)

    doc.startViewTransition(() => {
      flushSync(() => setTheme(next))
    })
  }, [])

  return {
    theme,
    setTheme: switchTheme,
    /** null until an Omarchy host resolves a theme, or if there isn't one —
     *  ThemeToggle only shows the "Synced with Omarchy" option when set. */
    omarchy: omarchyTheme ? { label: omarchySlugToLabel(omarchyTheme.slug) } : null,
  }
}

/**
 * Keeps the "Synced with Omarchy" theme live app-wide, independent of
 * `useTheme()` above. `useTheme()` is only called from the Settings page —
 * without this, switching the Omarchy theme while on Home/Library/Plugins
 * had no visible effect until you navigated back to Settings and its
 * subscription remounted. Mount this once, at the app root, so it's always
 * listening regardless of the current page.
 */
export function useOmarchyThemeSync(): void {
  useEffect(() => {
    if (!host.omarchy) return
    const applyIfActive = (t: OmarchyTheme | null) => {
      if (t && readStoredTheme() === 'omarchy') applyOmarchyTokens(t)
    }
    host.omarchy.get().then(applyIfActive)
    return host.omarchy.subscribe(applyIfActive)
  }, [])
}
