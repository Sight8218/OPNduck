import { useCallback, useState } from 'react'

export interface Preset<T> {
  name: string
  value: T
}

function read<T>(key: string): Preset<T>[] {
  try {
    const raw = localStorage.getItem(key)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/** Named, saved settings for one card (e.g. "MP3 320k"), kept in localStorage. */
export function usePresets<T>(cardKey: string) {
  const storageKey = `opnduck.presets.${cardKey}`
  const [presets, setPresets] = useState<Preset<T>[]>(() => read<T>(storageKey))

  const persist = useCallback(
    (next: Preset<T>[]) => {
      setPresets(next)
      try {
        localStorage.setItem(storageKey, JSON.stringify(next))
      } catch {
        /* storage unavailable — presets just won't survive a restart */
      }
    },
    [storageKey],
  )

  const save = (name: string, value: T) => {
    const clean = name.trim().slice(0, 40)
    if (!clean) return
    persist([...presets.filter((p) => p.name !== clean), { name: clean, value }])
  }
  const remove = (name: string) => persist(presets.filter((p) => p.name !== name))

  return { presets, save, remove }
}
