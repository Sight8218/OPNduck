import { DEFAULT_PREFS, normalizePrefs, type DownloaderPrefs } from '../features/downloader/options'

/**
 * Smart Mode: remember the last-used download setup and apply it to every new download — in the
 * Downloader card and in the command palette — so format, quality and subtitle choices are made
 * once. Off by default; when off nothing is stored or applied.
 */
const ON_KEY = 'opnduck.downloader.smart'
const LAST_KEY = 'opnduck.downloader.last'

export function isSmartMode(): boolean {
  try {
    return localStorage.getItem(ON_KEY) === '1'
  } catch {
    return false
  }
}

export function setSmartMode(on: boolean) {
  try {
    localStorage.setItem(ON_KEY, on ? '1' : '0')
  } catch {
    /* storage unavailable */
  }
}

/** The prefs a new download should start with: the remembered ones in Smart Mode, else defaults. */
export function initialPrefs(): DownloaderPrefs {
  if (!isSmartMode()) return DEFAULT_PREFS
  try {
    return normalizePrefs(JSON.parse(localStorage.getItem(LAST_KEY) ?? 'null'))
  } catch {
    return DEFAULT_PREFS
  }
}

export function rememberPrefs(prefs: DownloaderPrefs) {
  if (!isSmartMode()) return
  try {
    localStorage.setItem(LAST_KEY, JSON.stringify(prefs))
  } catch {
    /* storage unavailable */
  }
}
