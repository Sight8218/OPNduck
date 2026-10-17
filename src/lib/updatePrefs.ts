const AUTO_KEY = 'opnduck.updates.auto'
const SKIP_KEY = 'opnduck.updates.skipped'

export function getAutoCheck(): boolean {
  try {
    return localStorage.getItem(AUTO_KEY) !== '0'
  } catch {
    return true
  }
}
export function setAutoCheck(on: boolean) {
  try {
    localStorage.setItem(AUTO_KEY, on ? '1' : '0')
  } catch {
    /* storage unavailable */
  }
}
export function getSkippedTag(): string | null {
  try {
    return localStorage.getItem(SKIP_KEY)
  } catch {
    return null
  }
}
export function setSkippedTag(tag: string) {
  try {
    localStorage.setItem(SKIP_KEY, tag)
  } catch {
    /* storage unavailable */
  }
}
