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

import { useEffect, useState } from 'react'
import { useDevMode } from '../lib/devMode'

const HUD_KEY = 'opnduck.devhud'
const HUD_EVENT = 'opnduck:devhud'

export function isHudOn(): boolean {
  try {
    return localStorage.getItem(HUD_KEY) === '1'
  } catch {
    return false
  }
}

export function setHud(on: boolean): void {
  try {
    localStorage.setItem(HUD_KEY, on ? '1' : '0')
  } catch {
    /* storage unavailable */
  }
  window.dispatchEvent(new Event(HUD_EVENT))
}

// @category: dev/perf-hud
/** Corner overlay for developers: frames per second, JS heap, DOM size and window size. Toggled from Developer tools. */
export default function PerfHud() {
  const { devMode } = useDevMode()
  const [flag, setOn] = useState(isHudOn)
  const on = flag && devMode // the overlay is a dev-mode feature
  const [stats, setStats] = useState({ fps: 0, heapMB: 0, nodes: 0, size: '' })

  useEffect(() => {
    const sync = () => setOn(isHudOn())
    window.addEventListener(HUD_EVENT, sync)
    return () => window.removeEventListener(HUD_EVENT, sync)
  }, [])

  useEffect(() => {
    if (!on) return
    let frames = 0
    let raf = 0
    const count = () => {
      frames++
      raf = requestAnimationFrame(count)
    }
    raf = requestAnimationFrame(count)
    const timer = setInterval(() => {
      const mem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory
      setStats({
        fps: frames * 2, // sampled every 500 ms
        heapMB: mem ? Math.round(mem.usedJSHeapSize / 1048576) : 0,
        nodes: document.getElementsByTagName('*').length,
        size: `${window.innerWidth}×${window.innerHeight}`,
      })
      frames = 0
    }, 500)
    return () => {
      cancelAnimationFrame(raf)
      clearInterval(timer)
    }
  }, [on])

  if (!on) return null
  return (
    <div className="pointer-events-none fixed bottom-2 left-2 z-[1200] rounded-md bg-black/75 px-2 py-1 font-mono text-[11px] leading-snug text-green-300">
      {stats.fps} fps · {stats.heapMB} MB heap · {stats.nodes} nodes · {stats.size}
    </div>
  )
}
// --- end: dev/perf-hud ---
