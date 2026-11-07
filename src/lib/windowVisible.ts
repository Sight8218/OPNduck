import { useSyncExternalStore } from 'react'

/** Whether the window is on screen. Electron reports document.visibilityState = 'hidden' when it is hidden to the tray
 *  or minimized, so timers and looping animations can stop until it is shown again. */
const isVisible = () => document.visibilityState !== 'hidden'

function subscribe(listener: () => void): () => void {
  document.addEventListener('visibilitychange', listener)
  return () => document.removeEventListener('visibilitychange', listener)
}

export function useWindowVisible(): boolean {
  return useSyncExternalStore(subscribe, isVisible, () => true)
}

/** Marks <html data-window-hidden> while hidden; index.css pauses every CSS animation under it. Call once at startup. */
export function trackWindowVisibility(): void {
  const root = document.documentElement
  const sync = () => {
    root.toggleAttribute('data-window-hidden', !isVisible())
    // Not the focused window: only the decorative background stops (index.css); progress bars etc. keep running.
    root.toggleAttribute('data-window-blurred', !document.hasFocus())
  }
  document.addEventListener('visibilitychange', sync)
  window.addEventListener('focus', sync)
  window.addEventListener('blur', sync)
  sync()
}
