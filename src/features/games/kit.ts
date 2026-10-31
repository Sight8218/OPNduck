import { useCallback, useEffect, useRef, useState } from 'react'

/** Best score for a game, remembered in localStorage (falls back to this session if storage is blocked). */
export function useBest(game: string, lowerIsBetter = false): [number | null, (score: number) => void] {
  const key = `opnduck.arcade.best.${game}`
  const [best, setBest] = useState<number | null>(() => {
    try {
      const v = localStorage.getItem(key)
      return v == null ? null : Number(v)
    } catch {
      return null
    }
  })
  const report = useCallback(
    (score: number) => {
      setBest((prev) => {
        if (prev != null && (lowerIsBetter ? score >= prev : score <= prev)) return prev
        try {
          localStorage.setItem(key, String(score))
        } catch {
          /* session only */
        }
        return score
      })
    },
    [key, lowerIsBetter],
  )
  return [best, report]
}

const GAME_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '])

/** Calls `onKey` for key presses while the game is on screen; arrows and space never scroll the page. */
export function useKeys(onKey: (key: string, e: KeyboardEvent) => void) {
  const ref = useRef(onKey)
  useEffect(() => {
    ref.current = onKey
  })
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (GAME_KEYS.has(e.key)) e.preventDefault()
      ref.current(e.key, e)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])
}

/** Runs `step(dtSeconds)` every animation frame while mounted. dt is capped so a hidden tab can't teleport things. */
export function useFrameLoop(step: (dt: number) => void) {
  const ref = useRef(step)
  useEffect(() => {
    ref.current = step
  })
  useEffect(() => {
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      ref.current(dt)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])
}

/** Sizes a canvas for the screen's pixel ratio and returns a context in CSS pixels. */
export function setupCanvas(canvas: HTMLCanvasElement, w: number, h: number): CanvasRenderingContext2D {
  const dpr = window.devicePixelRatio || 1
  canvas.width = w * dpr
  canvas.height = h * dpr
  const ctx = canvas.getContext('2d')!
  ctx.scale(dpr, dpr)
  return ctx
}

export interface Palette {
  accent: string
  accentSoft: string
  bg: string
  text: string
  dim: string
}

/** The current theme's colors, read once when a game starts. */
export function readPalette(): Palette {
  const css = getComputedStyle(document.documentElement)
  const get = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback
  return {
    accent: get('--accent', '#4ade80'),
    accentSoft: get('--accent-soft', '#86efac'),
    bg: get('--bg-solid', '#101614'),
    text: get('--text', '#e5e7eb'),
    dim: get('--text-dim', '#9ca3af'),
  }
}
