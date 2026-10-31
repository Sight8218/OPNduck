import { useSyncExternalStore } from 'react'

/**
 * The secret Arcade: clicking the OPNduck wordmark unlocks it for good, and only then does
 * Settings offer to pin it to the menu. Both flags live in localStorage, with an in-memory
 * copy so everything still works when storage is blocked.
 */
const UNLOCK_KEY = 'opnduck.arcade.unlocked'
const PIN_KEY = 'opnduck.arcade.pinned'

function read(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

const state = { unlocked: read(UNLOCK_KEY), pinned: read(PIN_KEY) }
const listeners = new Set<() => void>()

function write(key: string, value: boolean) {
  try {
    localStorage.setItem(key, value ? '1' : '0')
  } catch {
    /* storage blocked: the in-memory copy still holds for this session */
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function unlockArcade(): void {
  if (state.unlocked) return
  state.unlocked = true
  write(UNLOCK_KEY, true)
  listeners.forEach((l) => l())
}

/** Pinning only does anything once the secret has been found. */
export function setArcadePinned(pinned: boolean): void {
  if (!state.unlocked) return
  state.pinned = pinned
  write(PIN_KEY, pinned)
  listeners.forEach((l) => l())
}

export const useArcadeUnlocked = () => useSyncExternalStore(subscribe, () => state.unlocked)
export const useArcadePinned = () => useSyncExternalStore(subscribe, () => state.pinned && state.unlocked)
