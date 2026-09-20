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
import {
  KEYBINDS,
  comboFromEvent,
  findConflict,
  getCombo,
  isDefault,
  resetCombo,
  setCapturing,
  setCombo,
} from '../lib/keybinds'

const ROW_TEXT: Record<string, string> = {
  'command-palette': 'Jump to any page or action.',
  'dev-mode-toggle': 'Shows the runtime backdrop-tuning dev panel.',
}

// @category: settings/keybinds
export default function KeybindsCard() {
  // Bumps on every write to force a re-render — combo/isDefault read straight
  // from storage on each render, so bumping this is all that's needed.
  const [, setVersion] = useState(0)
  const [capturingId, setCapturingId] = useState<string | null>(null)
  const [conflict, setConflict] = useState<{ id: string; label: string } | null>(null)

  useEffect(() => {
    if (!capturingId) return
    // Mutes every other keybind listener in the app for the duration of the
    // capture — see the comment on `capturing` in lib/keybinds.ts for why.
    setCapturing(true)
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      if (e.key === 'Escape') {
        setCapturingId(null)
        return
      }
      const combo = comboFromEvent(e)
      if (!combo) return // bare modifier press — keep listening
      const owner = findConflict(combo, capturingId)
      if (owner) {
        setConflict({ id: capturingId, label: owner.label })
        return
      }
      setCombo(capturingId, combo)
      setVersion((v) => v + 1)
      setCapturingId(null)
      setConflict(null)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      setCapturing(false)
    }
  }, [capturingId])

  function startCapture(id: string) {
    setConflict(null)
    setCapturingId(id)
  }

  function reset(id: string) {
    resetCombo(id)
    setVersion((v) => v + 1)
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-4">
      <span className="text-sm font-semibold text-[var(--text)]">Keybinds</span>
      {KEYBINDS.map((def, i) => {
        const capturing = capturingId === def.id
        return (
          <div
            key={def.id}
            className={`flex items-center justify-between gap-3 ${
              i < KEYBINDS.length - 1 ? 'border-b border-[var(--glass-border)] pb-3' : ''
            }`}
          >
            <div className="flex flex-col">
              <span className="text-sm text-[var(--text)]">{def.label}</span>
              <span className="text-xs text-[var(--text-dim)]">
                {conflict?.id === def.id
                  ? `Already used by ${conflict.label} — try another combo.`
                  : (ROW_TEXT[def.id] ?? '')}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <kbd
                className={`rounded-md border px-2 py-1 font-mono text-xs tracking-wider ${
                  capturing
                    ? 'border-[var(--input-border-focus)] bg-[var(--input-bg-hover)] text-[var(--text)]'
                    : 'border-[var(--glass-border)] bg-[var(--input-bg)] text-[var(--text)]'
                }`}
              >
                {capturing ? 'Press a key combo…' : getCombo(def.id)}
              </kbd>
              {capturing ? (
                <button
                  type="button"
                  className="glass-btn px-2 py-1 text-xs"
                  onClick={() => setCapturingId(null)}
                >
                  Cancel
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="glass-btn px-2 py-1 text-xs"
                    onClick={() => startCapture(def.id)}
                  >
                    Rebind
                  </button>
                  {!isDefault(def.id) && (
                    <button
                      type="button"
                      className="glass-btn px-2 py-1 text-xs"
                      onClick={() => reset(def.id)}
                    >
                      Reset
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
