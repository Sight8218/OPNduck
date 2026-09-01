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

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

/**
 * Fixed dev/debug-mode keybinding. Intentionally non-changeable for now so the
 * README/status docs can document a single stable shortcut. A keybindings menu
 * will arrive later and make binds configurable.
 */
export const DEV_BIND = 'Ctrl+Shift+D'

const STORAGE_KEY = 'opnduck.devmode'

interface DevModeValue {
  devMode: boolean
  toggle: () => void
}

const DevModeContext = createContext<DevModeValue | null>(null)

function readStored(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export function DevModeProvider({ children }: { children: ReactNode }) {
  const [devMode, setDevMode] = useState<boolean>(readStored)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'd') {
        e.preventDefault()
        setDevMode((prev) => {
          const next = !prev
          try {
            localStorage.setItem(STORAGE_KEY, next ? '1' : '0')
          } catch {
            /* storage unavailable */
          }
          return next
        })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const toggle = () => {
    setDevMode((prev) => {
      const next = !prev
      try {
        localStorage.setItem(STORAGE_KEY, next ? '1' : '0')
      } catch {
        /* storage unavailable */
      }
      return next
    })
  }

  return <DevModeContext.Provider value={{ devMode, toggle }}>{children}</DevModeContext.Provider>
}

export function useDevMode(): DevModeValue {
  const ctx = useContext(DevModeContext)
  if (!ctx) throw new Error('useDevMode must be used within a DevModeProvider')
  return ctx
}