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

import { useSyncExternalStore } from 'react'

const DONE_KEY = 'opnduck.setup.done'
const listeners = new Set<() => void>()

function readDone(): boolean {
  try {
    return localStorage.getItem(DONE_KEY) === '1'
  } catch {
    return true // storage unavailable: never nag
  }
}

const state = { open: false, done: readDone() }
const emit = () => listeners.forEach((l) => l())

export function openSetup(): void {
  state.open = true
  emit()
}

export function closeSetup(): void {
  state.open = false
  state.done = true
  try {
    localStorage.setItem(DONE_KEY, '1')
  } catch {
    /* storage unavailable */
  }
  emit()
}

/** True until the wizard has been closed once; the app opens it on the first launch. */
export const setupNeverShown = (): boolean => !state.done

export const useSetupOpen = (): boolean =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state.open,
  )
