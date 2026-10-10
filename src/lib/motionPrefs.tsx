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
import { MotionConfig } from 'framer-motion'

const STORAGE_KEY = 'opnduck.reducemotion'
const COMPACT_KEY = 'opnduck.compactdensity'

interface ReduceMotionValue {
  reduceMotion: boolean
  setReduceMotion: (v: boolean) => void
  compact: boolean
  setCompact: (v: boolean) => void
}

const ReduceMotionContext = createContext<ReduceMotionValue | null>(null)

function readStored(key = STORAGE_KEY): boolean {
  if (typeof window === 'undefined') return false
  try {
    return localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

/**
 * Global "reduce motion" and "compact density" preferences (Settings >
 * Appearance > Motion & Density). Both are mirrored onto <html> as data
 * attributes (`data-reduce-motion`, `data-density`) that index.css keys off:
 * reduce motion kills CSS transitions/animations app-wide and, via
 * MotionConfig, framer-motion's transform/layout animations; compact density
 * shrinks Tailwind's spacing scale.
 */
export function ReduceMotionProvider({ children }: { children: ReactNode }) {
  const [reduceMotion, setReduceMotionState] = useState<boolean>(() => readStored())
  const [compact, setCompactState] = useState<boolean>(() => readStored(COMPACT_KEY))

  useEffect(() => {
    const root = document.documentElement
    if (reduceMotion) root.setAttribute('data-reduce-motion', '')
    else root.removeAttribute('data-reduce-motion')
    if (compact) root.setAttribute('data-density', 'compact')
    else root.removeAttribute('data-density')
  }, [reduceMotion, compact])

  const setReduceMotion = (v: boolean) => {
    setReduceMotionState(v)
    try {
      localStorage.setItem(STORAGE_KEY, v ? '1' : '0')
    } catch {
      /* storage unavailable */
    }
  }

  const setCompact = (v: boolean) => {
    setCompactState(v)
    try {
      localStorage.setItem(COMPACT_KEY, v ? '1' : '0')
    } catch {
      /* storage unavailable */
    }
  }

  return (
    <ReduceMotionContext.Provider value={{ reduceMotion, setReduceMotion, compact, setCompact }}>
      <MotionConfig reducedMotion={reduceMotion ? 'always' : 'user'}>{children}</MotionConfig>
    </ReduceMotionContext.Provider>
  )
}

export function useReduceMotion(): ReduceMotionValue {
  const ctx = useContext(ReduceMotionContext)
  if (!ctx) throw new Error('useReduceMotion must be used within a ReduceMotionProvider')
  return ctx
}
