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

import { detectElectronHost } from './electron'

export interface HostWindowControls {
  minimize(): void
  maximize(): void
  close(): void
}

export type DownloadFormat = 'MP4' | 'MP3' | 'MKV' | 'MOV' | 'FLAC' | 'WAV'

/** Max vertical resolution to download at; 'best' takes whatever the source offers. */
export type VideoQuality = 'best' | '2160' | '1080' | '720' | '480' | '360'

/** Target MP3 bitrate; 'best' uses yt-dlp's best VBR. FLAC/WAV are lossless — no bitrate choice. */
export type AudioQuality = 'best' | '320k' | '192k' | '128k'

export interface DownloadRequest {
  url: string
  format: DownloadFormat
  videoQuality?: VideoQuality
  audioQuality?: AudioQuality
  /** Overrides the Settings default destination for this one job. */
  destination?: string
  /** Size estimate from a prior probe(), carried through so the task/tag can show it immediately. */
  approxSizeBytes?: number | null
  /** Thumbnail URL from a prior probe(), carried through so the task row can show it immediately. */
  thumbnailUrl?: string | null
}

export interface DownloadProbe {
  title: string
  approxSizeBytes: number | null
  thumbnailUrl: string | null
}

export type TaskStatus = 'queued' | 'running' | 'done' | 'error' | 'canceled'

export interface TaskState {
  id: string
  /** Room for 'convert' | 'upscale' once those backends land. */
  kind: 'download'
  status: TaskStatus
  /** 0-1 */
  progress: number
  /** Url or resolved title once yt-dlp reports one. */
  label: string
  error?: string
  format: DownloadFormat
  /** Human label for the chosen video/audio quality, e.g. "1080p" or "192k". */
  quality: string
  sizeBytes: number | null
  /** True until sizeBytes is replaced by the real file size on completion. */
  sizeIsEstimate: boolean
  thumbnailUrl: string | null
}

export interface HostTasks {
  startDownload(req: DownloadRequest): Promise<string>
  cancel(taskId: string): void
  list(): TaskState[]
  /** Fires with the full task list on every change. Returns an unsubscribe fn. */
  subscribe(listener: (tasks: TaskState[]) => void): () => void
  /** Resolves the platform default download folder (e.g. ~/Downloads/OPNduck). */
  getDefaultDownloadDir(): Promise<string>
  /** Looks up the title and an approximate download size without downloading anything. */
  probe(req: DownloadRequest): Promise<DownloadProbe>
}

export interface YtDlpStatus {
  available: boolean
  /** A copy-pasteable install command for the current OS. */
  installHint: string
}

export interface Host {
  readonly platformName: string
  readonly isDesktop: boolean
  /** Minimal, materialisable window controls for the fake/decorated chrome. */
  window: HostWindowControls
  /** Open a native file picker. Returns a path or null when cancelled. */
  pickFile(options?: { extensions?: string[] }): Promise<string | null>
  /** Open a native folder picker. Returns a path or null when cancelled. */
  pickFolder(): Promise<string | null>
  /** yt-dlp isn't bundled — checks whether it's on PATH, with an install hint if not. */
  checkYtDlp(): Promise<YtDlpStatus>
  tasks: HostTasks
}

/** No-op task queue for the browser preview — desktop features aren't available there. */
const browserTasks: HostTasks = {
  startDownload: async (req) => {
    const id = crypto.randomUUID()
    browserTaskList = [
      {
        id,
        kind: 'download',
        status: 'error',
        progress: 0,
        label: 'Downloader requires the desktop app',
        error: 'Desktop app required',
        format: req.format,
        quality: req.videoQuality ?? req.audioQuality ?? 'best',
        sizeBytes: null,
        sizeIsEstimate: false,
        thumbnailUrl: null,
      },
    ]
    browserListeners.forEach((l) => l(browserTaskList))
    return id
  },
  cancel: () => {},
  list: () => browserTaskList,
  subscribe: (listener) => {
    browserListeners.add(listener)
    return () => browserListeners.delete(listener)
  },
  getDefaultDownloadDir: async () => '',
  probe: async () => ({ title: 'Desktop app required', approxSizeBytes: null, thumbnailUrl: null }),
}
let browserTaskList: TaskState[] = []
const browserListeners = new Set<(tasks: TaskState[]) => void>()

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
  pickFolder: async () => null,
  checkYtDlp: async () => ({ available: false, installHint: 'Desktop app required' }),
  tasks: browserTasks,
}

/**
 * Runtime host. Electron adapter is used when the preload bridge is present
 * (running inside the desktop shell); otherwise fall back to browser no-ops.
 * The Tauri adapter will join later behind the same `Host` interface.
 */
export const host: Host = (() => {
  if (typeof window !== 'undefined' && window.opnduckHost) {
    // Sync adapter: the bridge is already on window (set by preload). Tiny and
    // only activated when the bridge exists.
    return detectElectronHost() ?? browserHost
  }
  return browserHost
})()
