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
import { applyTheme, readStoredTheme, type Theme } from './theme'

/**
 * React bindings for the OPNduck theme engine.
 * Applies `data-theme` to <html> and persists the choice to localStorage.
 */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => readStoredTheme())

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  const switchTheme = useCallback((next: Theme) => {
    setTheme(next)
  }, [])

  return { theme, setTheme: switchTheme }
}
