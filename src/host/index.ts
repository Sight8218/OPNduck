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
 * OPNduck Host Interface — the single seam between the UI and the native shell.
 *
 * The React tree calls ONLY these functions for anything OS/native related.
 * This is what makes the Electron → Tauri swap cheap: each shell gets an
 * adapter that implements the same interface, so the UI never changes.
 *
 * Currently every implementation is a browser no-op — the desktop shell
 * adapters (Electron IPC / Tauri commands) are added when that phase lands.
 */

export interface HostWindowControls {
  minimize(): void
  maximize(): void
  close(): void
}

export interface Host {
  readonly platformName: string
  readonly isDesktop: boolean
  /** Minimal, materialisable window controls for the fake/decorated chrome. */
  window: HostWindowControls
  /** Open a native file/folder picker. Returns a path or null when cancelled. */
  pickFile(options?: { extensions?: string[] }): Promise<string | null>
  /** Wrapper for future task orchestration (download/convert/upscale). */
  // tasks: HostTasks  -- wired in the backends phase
}

/** Browser preview adapter — no native capabilities, all no-ops. */
const browserHost: Host = {
  platformName: 'browser',
  isDesktop: false,
  window: {
    minimize: () => {},
    maximize: () => {},
    close: () => {},
  },
  pickFile: async () => null,
}

/** Runtime host. Electron/Tauri adapters will replace this in `shell/`. */
export const host: Host = browserHost
