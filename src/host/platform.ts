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
 * Platform identification + OS-aware behavior.
 *
 * Kept dependency-free and imported by both browser and desktop shells so the
 * UI never has to care which OS it runs on. `host` picks up Electron/Tauri data
 * directories later; for now this drives path separators, overlay styling and
 * the frameless titlebar "window chrome" behavior.
 */

export type DesktopPlatform = 'linux' | 'windows' | 'macos' | 'unknown'

export interface PlatformInfo {
  /** Lowercased node `process.platform` or browser UA-based guess. */
  name: DesktopPlatform
  /** True when running inside a desktop shell (Electron now, Tauri later). */
  isDesktop: boolean
  /** Path separator (`/` on posix, `\` on windows). */
  sep: string
  /** Preferred data/config directory. Placeholder until shell provides real paths. */
  dataDir: string
}

function detectPlatform(): DesktopPlatform {
  // Electron / Node speaks first.
  const proc = (globalThis as { process?: { platform?: string } }).process
  if (proc?.platform) {
    const p = proc.platform
    if (p === 'win32') return 'windows'
    if (p === 'darwin') return 'macos'
    if (p === 'linux') return 'linux'
    return 'unknown'
  }
  // Browser fallback.
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
  if (/Windows/i.test(ua)) return 'windows'
  if (/Macintosh|Mac OS X/i.test(ua)) return 'macos'
  if (/Linux/i.test(ua)) return 'linux'
  return 'unknown'
}

const platform: PlatformInfo = (() => {
  const name = detectPlatform()
  return {
    name,
    isDesktop: Boolean((globalThis as { process?: { platform?: string } }).process?.platform),
    sep: name === 'windows' ? '\\' : '/',
    dataDir: name === 'windows' ? '%APPDATA%\\opnduck' : '~/.local/share/opnduck',
  }
})()

/** Query whether the renderer should render a custom (fake) OS window chrome. */
export function needsCustomChrome(): boolean {
  // In the browser we show a decorative titlebar; inside a desktop shell the
  // real frameless window supplies it (Electron `titleBarStyle: hidden`,
  // Tauri decorated:false). Both still use the same drag-region markup.
  return !platform.isDesktop
}

export default platform
