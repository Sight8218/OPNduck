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

/**
 * Small central registry for rebindable app shortcuts. Each consumer
 * (CommandPalette, DevModeProvider, ...) calls `matchesBinding(event, id)`
 * from its own keydown listener instead of hardcoding a key check, so the
 * Settings > Keybinds UI can change behavior just by writing to storage —
 * no event bus needed, since matchesBinding reads the current combo fresh
 * on every keydown.
 */

export interface KeybindDef {
  id: string
  label: string
  defaultCombo: string
}

export const KEYBINDS: KeybindDef[] = [
  { id: 'command-palette', label: 'Command palette', defaultCombo: 'Ctrl+K' },
  { id: 'dev-mode-toggle', label: 'Toggle developer / debug mode', defaultCombo: 'Ctrl+Shift+D' },
]

const STORAGE_KEY = 'opnduck.keybinds'

function readOverrides(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    // A hand-edited/corrupt value like "null" or an array would otherwise throw on every keydown.
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function writeOverrides(overrides: Record<string, string>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides))
  } catch {
    /* storage unavailable — rebind just won't persist across restarts */
  }
}

const BAD_KEY_TOKENS = ['Unidentified', 'Process']

export function getCombo(id: string): string {
  const def = KEYBINDS.find((k) => k.id === id)
  const stored = readOverrides()[id]
  // Self-heals a bad value saved before comboFromEvent started filtering
  // these out — falls back to default instead of staying permanently broken.
  if (stored && BAD_KEY_TOKENS.some((t) => stored.includes(t))) return def?.defaultCombo ?? ''
  return stored ?? def?.defaultCombo ?? ''
}

export function setCombo(id: string, combo: string): void {
  const overrides = readOverrides()
  overrides[id] = combo
  writeOverrides(overrides)
}

export function resetCombo(id: string): void {
  const overrides = readOverrides()
  delete overrides[id]
  writeOverrides(overrides)
}

export function isDefault(id: string): boolean {
  const stored = readOverrides()[id]
  return stored === undefined || BAD_KEY_TOKENS.some((t) => stored.includes(t))
}

/** Which other action already owns this combo, if any — used to block conflicting rebinds. */
export function findConflict(combo: string, excludeId: string): KeybindDef | null {
  return KEYBINDS.find((def) => def.id !== excludeId && getCombo(def.id) === combo) ?? null
}

/** Canonical combo string from a KeyboardEvent, e.g. "Ctrl+Shift+D". Null for a bare
 *  modifier press, or for a key the browser/compositor couldn't cleanly identify —
 *  some Linux keyboard layouts/compositors/input methods report a key as
 *  "Unidentified" or "Process" (mid-IME-composition) instead of its real value,
 *  which would otherwise get captured as a literal, useless combo string. */
export function comboFromEvent(e: KeyboardEvent): string | null {
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return null
  // Letters, digits and Space are read from the PHYSICAL key (e.code), not e.key. With Ctrl
  // held, e.key is unreliable: input methods (fcitx/ibus) report "Process"/"Unidentified",
  // and other layouts or AltGr report a different character — which made Ctrl+Space and
  // friends silently never match while plain Ctrl+letter happened to work.
  let key: string
  if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3)
  else if (/^Digit[0-9]$/.test(e.code)) key = e.code.slice(5)
  else if (e.code === 'Space') key = 'Space'
  else if (BAD_KEY_TOKENS.includes(e.key)) return null
  else key = e.key === ' ' ? 'Space' : e.key.length === 1 ? e.key.toUpperCase() : e.key
  const parts: string[] = []
  // Ctrl and Cmd/Meta are treated as the same logical modifier so one combo
  // string works whether the shortcut was recorded on Linux/Windows or macOS.
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')
  parts.push(key)
  return parts.join('+')
}

// While the Settings > Keybinds capture UI is listening for a new combo,
// every OTHER keydown listener in the app (CommandPalette, DevModeProvider)
// needs to go quiet — otherwise pressing the key combo you're *replacing*
// (a completely normal thing to do while rebinding) also fires that old
// binding's own handler on the same keystroke. For "rebind command palette,
// then press its current combo Ctrl+Space to test/reconfirm it," that meant
// the palette popped open over the Settings page mid-capture, which looked
// exactly like "the rebind didn't register" even though it actually had.
let capturing = false

export function setCapturing(value: boolean): void {
  capturing = value
}

/** True if this KeyboardEvent matches the current (possibly rebound) combo for `id`. */
export function matchesBinding(e: KeyboardEvent, id: string): boolean {
  if (capturing) return false
  const combo = comboFromEvent(e)
  return combo !== null && combo === getCombo(id)
}
