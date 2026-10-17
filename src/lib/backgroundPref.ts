import { useEffect, useSyncExternalStore } from 'react'

export type BackgroundStyle = 'flat' | 'gradient'

const STORAGE_KEY = 'opnduck.background'
const listeners = new Set<() => void>()

function read(): BackgroundStyle {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'gradient' ? 'gradient' : 'flat'
  } catch {
    return 'flat'
  }
}

let current: BackgroundStyle = read()

function apply(style: BackgroundStyle) {
  document.documentElement.setAttribute('data-bg', style)
}

// Apply at import time so the very first paint already uses the saved choice.
if (typeof document !== 'undefined') apply(current)

function setBackgroundStyle(style: BackgroundStyle) {
  current = style
  try {
    localStorage.setItem(STORAGE_KEY, style)
  } catch {
    /* storage unavailable — the choice just won't survive a restart */
  }
  apply(style)
  listeners.forEach((l) => l())
}

export function useBackgroundStyle(): [BackgroundStyle, (s: BackgroundStyle) => void] {
  const style = useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => {
        listeners.delete(l)
      }
    },
    () => current,
  )
  return [style, setBackgroundStyle]
}

/** Mount once at the app root: mirrors the saved choice onto <html data-bg>. Default is flat. */
export function useBackgroundSync() {
  useEffect(() => apply(current), [])
}
