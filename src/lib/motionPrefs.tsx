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

import { createContext, useContext, useState, type ReactNode } from 'react'

const STORAGE_KEY = 'opnduck.reducemotion'

interface ReduceMotionValue {
  reduceMotion: boolean
  setReduceMotion: (v: boolean) => void
}

const ReduceMotionContext = createContext<ReduceMotionValue | null>(null)

function readStored(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * Global "reduce motion" preference (Settings > Appearance > Motion &
 * Density). Currently governs decorative hover effects (card lift + glow on
 * Home) — the app-wide page-transition animation is a single deliberate
 * moment rather than scattered per-element motion, so it's left alone here.
 */
export function ReduceMotionProvider({ children }: { children: ReactNode }) {
  const [reduceMotion, setReduceMotionState] = useState<boolean>(readStored)

  const setReduceMotion = (v: boolean) => {
    setReduceMotionState(v)
    try {
      localStorage.setItem(STORAGE_KEY, v ? '1' : '0')
    } catch {
      /* storage unavailable */
    }
  }

  return (
    <ReduceMotionContext.Provider value={{ reduceMotion, setReduceMotion }}>
      {children}
    </ReduceMotionContext.Provider>
  )
}

export function useReduceMotion(): ReduceMotionValue {
  const ctx = useContext(ReduceMotionContext)
  if (!ctx) throw new Error('useReduceMotion must be used within a ReduceMotionProvider')
  return ctx
}
