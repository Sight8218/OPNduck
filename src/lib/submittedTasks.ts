import { useCallback, useSyncExternalStore } from 'react'

/**
 * Which task ids each Home card submitted. Lives at module scope (not in
 * component state) so a card that remounts — you left Home and came back —
 * still shows its running jobs' progress, and still disables its button while
 * they run. Without this the card forgot its jobs and a second click started a
 * duplicate.
 */
const EMPTY: string[] = []
const store = new Map<string, string[]>()
const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useSubmittedIds(key: string): [string[], (ids: string[]) => void] {
  const ids = useSyncExternalStore(subscribe, () => store.get(key) ?? EMPTY)
  const setIds = useCallback(
    (next: string[]) => {
      store.set(key, next)
      listeners.forEach((l) => l())
    },
    [key],
  )
  return [ids, setIds]
}
