import { useState } from 'react'
import GlassTune from './GlassTune'
import type { Theme } from '../themes/theme'

/**
 * Developer tools, gated behind dev mode (Ctrl+Shift+D). GlassTune is the
 * original backdrop-tuning panel; the rest are small, genuinely-functional
 * utilities for developing OPNduck itself rather than UI shell placeholders.
 */
export default function DevTools({ theme }: { theme: Theme }) {
  const [outlineOn, setOutlineOn] = useState(false)
  const [copied, setCopied] = useState(false)

  const toggleOutline = () => {
    const next = !outlineOn
    setOutlineOn(next)
    document.documentElement.classList.toggle('opnduck-debug-outline', next)
  }

  const resetAll = () => {
    if (!confirm('Clear all local OPNduck settings (theme, dev mode, nav display, etc.) and reload?')) return
    localStorage.clear()
    location.reload()
  }

  const copyDebugInfo = async () => {
    const nav = navigator as Navigator & { deviceMemory?: number; hardwareConcurrency?: number }
    const info = {
      userAgent: navigator.userAgent,
      hardwareConcurrency: nav.hardwareConcurrency,
      deviceMemory: nav.deviceMemory,
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      dpr: window.devicePixelRatio,
      localStorage: { ...localStorage },
    }
    try {
      await navigator.clipboard.writeText(JSON.stringify(info, null, 2))
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard may be blocked */
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-4">
        <span className="text-sm font-semibold text-[var(--text)]">Developer Tools</span>
        <p className="text-xs text-[var(--text-dim)]">
          Only visible with dev mode on ({''}
          <kbd className="rounded border border-[var(--glass-border)] bg-[var(--input-bg)] px-1 py-0.5 font-mono text-[10px]">
            Ctrl+Shift+D
          </kbd>
          ).
        </p>

        <div className="flex items-center justify-between gap-3 border-t border-[var(--glass-border)] pt-3">
          <div className="flex flex-col">
            <span className="text-sm text-[var(--text)]">Layout outline</span>
            <span className="text-xs text-[var(--text-dim)]">Outlines every .glass surface to check spacing/alignment.</span>
          </div>
          <button
            type="button"
            onClick={toggleOutline}
            className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
              outlineOn
                ? 'border-[var(--input-border-focus)] bg-[var(--input-bg)] text-[var(--text)]'
                : 'border-[var(--glass-border)] bg-transparent text-[var(--text-dim)] hover:text-[var(--text)]'
            }`}
          >
            {outlineOn ? 'On' : 'Off'}
          </button>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-[var(--glass-border)] pt-3">
          <div className="flex flex-col">
            <span className="text-sm text-[var(--text)]">Copy debug info</span>
            <span className="text-xs text-[var(--text-dim)]">System specs + everything in localStorage, as JSON.</span>
          </div>
          <button
            type="button"
            onClick={copyDebugInfo}
            className="glass-btn px-3 py-1.5 text-xs"
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-[var(--glass-border)] pt-3">
          <div className="flex flex-col">
            <span className="text-sm text-[var(--text)]">Reset all local settings</span>
            <span className="text-xs text-[var(--text-dim)]">Clears theme, dev mode, nav display — everything in localStorage.</span>
          </div>
          <button
            type="button"
            onClick={resetAll}
            className="rounded-lg border border-red-900/50 bg-red-950/40 px-3 py-1.5 text-xs font-semibold text-red-300 transition-colors hover:bg-red-950/70"
          >
            Reset
          </button>
        </div>
      </div>

      <GlassTune theme={theme} />
    </div>
  )
}
