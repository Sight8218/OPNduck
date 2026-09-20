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
import { applyTheme, readStoredTheme, type Theme } from './theme'

type ViewTransitionDocument = Document & {
  startViewTransition?: (callback: () => void) => { ready: Promise<void> }
}

/** Where on screen the switch was triggered from — the circle-wipe
 *  animation expands outward from this point. Defaults to viewport center. */
export type ThemeSwitchOrigin = { x: number; y: number }

/**
 * React bindings for the OPNduck theme engine.
 * Applies `data-theme` to <html> and persists the choice to localStorage.
 */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => readStoredTheme())

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  const switchTheme = useCallback((next: Theme, origin?: ThemeSwitchOrigin) => {
    const doc = document as ViewTransitionDocument
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

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

  return { theme, setTheme: switchTheme }
}
