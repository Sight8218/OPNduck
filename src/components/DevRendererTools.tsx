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
import { TOKEN_KEYS } from '../themes/omarchySync'
import { isHudOn, setHud } from './PerfHud'

const SIZES: [string, number, number][] = [
  ['Min 940×600', 940, 600],
  ['1280×820', 1280, 820],
  ['1600×900', 1600, 900],
  ['1920×1080', 1920, 1080],
]

const btn = 'glass-btn px-3 py-1.5 text-xs'
const row = 'flex flex-col gap-2 border-t border-[var(--glass-border)] pt-3'

// @category: dev/dev-renderer-tools
/** Developer tools that work in the browser too: perf overlay, theme token viewer, storage editor, window sizes. */
export default function DevRendererTools() {
  const [hud, setHudState] = useState(isHudOn)
  const [tokens, setTokens] = useState<[string, string][]>([])
  const [storage, setStorage] = useState<[string, string][]>([])
  const [copied, setCopied] = useState(false)
  const [outlines, setOutlines] = useState(() => document.documentElement.classList.contains('dev-outlines'))

  const readTokens = useCallback(() => {
    const cs = getComputedStyle(document.documentElement)
    setTokens(TOKEN_KEYS.map((k) => [k, cs.getPropertyValue(k).trim()]))
  }, [])
  const readStorage = useCallback(() => {
    try {
      setStorage(Object.keys(localStorage).sort().map((k) => [k, localStorage.getItem(k) ?? '']))
    } catch {
      setStorage([])
    }
  }, [])

  useEffect(() => {
    readTokens()
    readStorage()
  }, [readTokens, readStorage])

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-4">
      <span className="text-sm font-semibold text-[var(--text)]">Inspect &amp; tweak</span>

      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col">
          <span className="text-sm text-[var(--text)]">Performance overlay</span>
          <span className="text-xs text-[var(--text-dim)]">FPS, JS heap, DOM node count and window size in the corner.</span>
        </div>
        <button type="button" className={btn} onClick={() => (setHud(!hud), setHudState(!hud))}>
          {hud ? 'On' : 'Off'}
        </button>
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col">
          <span className="text-sm text-[var(--text)]">Layout outlines</span>
          <span className="text-xs text-[var(--text-dim)]">Draws a thin outline around every element, to spot overflow and spacing problems.</span>
        </div>
        <button
          type="button"
          className={btn}
          onClick={() => {
            document.documentElement.classList.toggle('dev-outlines', !outlines)
            setOutlines(!outlines)
          }}
        >
          {outlines ? 'On' : 'Off'}
        </button>
      </div>

      <div className={row}>
        <span className="text-sm text-[var(--text)]">Window size</span>
        <div className="flex flex-wrap gap-2">
          {SIZES.map(([label, w, h]) => (
            <button key={label} type="button" className={btn} onClick={() => window.resizeTo(w, h)}>
              {label}
            </button>
          ))}
        </div>
        <span className="text-[11px] text-[var(--text-faint)]">A tiling window manager may ignore this and keep its own size.</span>
      </div>

      <details className={row}>
        <summary className="cursor-pointer text-sm text-[var(--text)]">Theme tokens ({tokens.length})</summary>
        <div className="mt-2 flex gap-2">
          <button type="button" className={btn} onClick={readTokens}>Refresh</button>
          <button
            type="button"
            className={btn}
            onClick={() => void navigator.clipboard.writeText(tokens.map(([k, v]) => `${k}: ${v};`).join('\n')).then(() => (setCopied(true), setTimeout(() => setCopied(false), 1500)))}
          >
            {copied ? 'Copied!' : 'Copy as CSS'}
          </button>
        </div>
        <div className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
          {tokens.map(([k, v]) => (
            <div key={k} className="flex items-center justify-between gap-2 font-mono text-[11px]">
              <span className="flex items-center gap-1.5 text-[var(--text-dim)]">
                <span className="h-3 w-3 shrink-0 rounded-sm border border-white/20" style={{ background: `var(${k})` }} />
                {k}
              </span>
              <span className="truncate text-[var(--text)]" title={v}>{v}</span>
            </div>
          ))}
        </div>
      </details>

      <details className={row} onToggle={(e) => (e.currentTarget as HTMLDetailsElement).open && readStorage()}>
        <summary className="cursor-pointer text-sm text-[var(--text)]">Local storage ({storage.length} keys)</summary>
        <div className="mt-2 flex flex-col gap-1">
          {storage.map(([k, v]) => (
            <div key={k} className="flex items-center justify-between gap-2 font-mono text-[11px]">
              <span className="min-w-0 flex-1 truncate" title={`${k} = ${v}`}>
                <span className="text-[var(--text)]">{k}</span> <span className="text-[var(--text-faint)]">= {v.slice(0, 80)}</span>
              </span>
              <button
                type="button"
                className="shrink-0 text-red-300 hover:text-red-200"
                onClick={() => {
                  try {
                    localStorage.removeItem(k)
                  } catch {
                    /* ignore */
                  }
                  readStorage()
                }}
              >
                delete
              </button>
            </div>
          ))}
          {!storage.length && <span className="text-xs text-[var(--text-faint)]">Empty.</span>}
        </div>
        <span className="mt-1 text-[11px] text-[var(--text-faint)]">Some values only take effect after a reload.</span>
      </details>
    </div>
  )
}
// --- end: dev/dev-renderer-tools ---
