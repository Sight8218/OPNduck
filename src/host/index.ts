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
import type { OmarchyTheme } from '../themes/omarchySync'

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

/** Output container for the Converter. Transcode picks one default codec per container. */
export type ContainerFormat = 'MP4' | 'MKV' | 'WEBM' | 'MOV'

/** 'remux' = stream copy, no re-encode (fast, only works if the source codec fits the
 *  container). 'transcode' = re-encode with a fixed default codec per container. */
export type ConvertMode = 'remux' | 'transcode'

export interface ConvertRequest {
  inputPath: string
  container: ContainerFormat
  mode: ConvertMode
  /** Overrides the Settings default destination for this one job. */
  destination?: string
}

/** realesr-animevideov3 works at 2x/3x/4x and is the fast general-purpose default;
 *  the other two are x4-only, so picking one locks the scale to 4. */
export type UpscaleModel = 'realesr-animevideov3' | 'realesrgan-x4plus' | 'realesrgan-x4plus-anime'
export type UpscaleScale = 2 | 3 | 4

export interface UpscaleRequest {
  inputPath: string
  scale: UpscaleScale
  model: UpscaleModel
  /** Overrides the Settings default destination for this one job. */
  destination?: string
}

/** How much to multiply the source frame rate by — 2x doubles it, 4x quadruples it. */
export type InterpolateMultiplier = 2 | 4

export interface InterpolateRequest {
  inputPath: string
  multiplier: InterpolateMultiplier
  /** Overrides the Settings default destination for this one job. */
  destination?: string
}

export type TaskKind = 'download' | 'convert' | 'upscale' | 'interpolate'
export type TaskStatus = 'queued' | 'running' | 'done' | 'error' | 'canceled'

export interface TaskState {
  id: string
  kind: TaskKind
  status: TaskStatus
  /** 0-1 */
  progress: number
  /** Url/title for a download, source file name for a conversion. */
  label: string
  error?: string
  /** Format/container tag shown in the UI, e.g. "MP4" or "192k". */
  format: string
  /** Human label for quality/mode, e.g. "1080p", "192k", or "Remux"/"Transcode". */
  quality: string
  sizeBytes: number | null
  /** True until sizeBytes is replaced by the real file size on completion. */
  sizeIsEstimate: boolean
  /** Always null for conversions — no natural thumbnail source. */
  thumbnailUrl: string | null
  /** Set when this "download" is actually a YouTube search matched from a
   *  Spotify track link (Spotify itself is DRM-protected — see main.cjs's
   *  resolveSpotifyTrack). Non-null means the UI MUST show this as a
   *  distinct tag rather than implying the file came from Spotify. */
  experimentalMatch: string | null
}

export interface HostTasks {
  startDownload(req: DownloadRequest): Promise<string>
  startConvert(req: ConvertRequest): Promise<string>
  startUpscale(req: UpscaleRequest): Promise<string>
  startVideoUpscale(req: UpscaleRequest): Promise<string>
  startInterpolate(req: InterpolateRequest): Promise<string>
  cancel(taskId: string): void
  list(): TaskState[]
  /** Fires with the full task list on every change. Returns an unsubscribe fn. */
  subscribe(listener: (tasks: TaskState[]) => void): () => void
  /** Resolves the platform default download folder (e.g. ~/Downloads/OPNduck). */
  getDefaultDownloadDir(): Promise<string>
  /** Looks up the title and an approximate download size without downloading anything. */
  probe(req: DownloadRequest): Promise<DownloadProbe>
}

export interface ToolStatus {
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
  /** Open a native multi-file picker. Returns paths or null when cancelled. */
  pickFiles(options?: { extensions?: string[] }): Promise<string[] | null>
  /** Open a native folder picker. Returns a path or null when cancelled. */
  pickFolder(): Promise<string | null>
  /** yt-dlp isn't bundled — checks whether it's on PATH, with an install hint if not. */
  checkYtDlp(): Promise<ToolStatus>
  /** ffmpeg isn't bundled either — same check, for the Converter. */
  checkFfmpeg(): Promise<ToolStatus>
  /** realesrgan-ncnn-vulkan isn't bundled either, and unlike yt-dlp/ffmpeg it's
   *  essentially never pre-installed — same check shape, for the Image Upscaler. */
  checkRealesrgan(): Promise<ToolStatus>
  /** rife-ncnn-vulkan isn't bundled either — same check shape, for Frame Interpolation. */
  checkRife(): Promise<ToolStatus>
  tasks: HostTasks
  /** Present only on hosts that can see the OS-level Omarchy theme (Electron
   *  on Linux); undefined everywhere else, including a non-Omarchy Linux
   *  desktop that just happens to run Electron. */
  omarchy?: {
    /** Current Omarchy theme, or null if Omarchy isn't installed/detected. */
    get(): Promise<OmarchyTheme | null>
    /** Fires on every live Omarchy theme change. Returns an unsubscribe fn. */
    subscribe(listener: (theme: OmarchyTheme | null) => void): () => void
  }
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
        experimentalMatch: null,
      },
    ]
    browserListeners.forEach((l) => l(browserTaskList))
    return id
  },
  startConvert: async (req) => {
    const id = crypto.randomUUID()
    browserTaskList = [
      {
        id,
        kind: 'convert',
        status: 'error',
        progress: 0,
        label: 'Converter requires the desktop app',
        error: 'Desktop app required',
        format: req.container,
        quality: req.mode === 'remux' ? 'Remux' : 'Transcode',
        sizeBytes: null,
        sizeIsEstimate: false,
        thumbnailUrl: null,
        experimentalMatch: null,
      },
    ]
    browserListeners.forEach((l) => l(browserTaskList))
    return id
  },
  startUpscale: async (req) => {
    const id = crypto.randomUUID()
    browserTaskList = [
      {
        id,
        kind: 'upscale',
        status: 'error',
        progress: 0,
        label: 'Image Upscaler requires the desktop app',
        error: 'Desktop app required',
        format: req.model,
        quality: `${req.scale}×`,
        sizeBytes: null,
        sizeIsEstimate: false,
        thumbnailUrl: null,
        experimentalMatch: null,
      },
    ]
    browserListeners.forEach((l) => l(browserTaskList))
    return id
  },
  startVideoUpscale: async (req) => {
    const id = crypto.randomUUID()
    browserTaskList = [
      {
        id,
        kind: 'upscale',
        status: 'error',
        progress: 0,
        label: 'Video Upscaler requires the desktop app',
        error: 'Desktop app required',
        format: req.model,
        quality: `${req.scale}×`,
        sizeBytes: null,
        sizeIsEstimate: false,
        thumbnailUrl: null,
        experimentalMatch: null,
      },
    ]
    browserListeners.forEach((l) => l(browserTaskList))
    return id
  },
  startInterpolate: async (req) => {
    const id = crypto.randomUUID()
    browserTaskList = [
      {
        id,
        kind: 'interpolate',
        status: 'error',
        progress: 0,
        label: 'Frame Interpolation requires the desktop app',
        error: 'Desktop app required',
        format: 'RIFE',
        quality: `${req.multiplier}× frames`,
        sizeBytes: null,
        sizeIsEstimate: false,
        thumbnailUrl: null,
        experimentalMatch: null,
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
  pickFiles: async () => null,
  pickFolder: async () => null,
  checkYtDlp: async () => ({ available: false, installHint: 'Desktop app required' }),
  checkFfmpeg: async () => ({ available: false, installHint: 'Desktop app required' }),
  checkRealesrgan: async () => ({ available: false, installHint: 'Desktop app required' }),
  checkRife: async () => ({ available: false, installHint: 'Desktop app required' }),
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
