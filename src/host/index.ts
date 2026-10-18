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
 * Two implementations exist: the Electron adapter (src/host/electron.ts, over the preload
 * bridge) and a browser no-op fallback below. A Tauri adapter could join later.
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
export type VideoQuality = 'best' | '4320' | '2160' | '1440' | '1080' | '720' | '480' | '360'

/** Target MP3 bitrate; 'best' uses yt-dlp's best VBR. FLAC/WAV are lossless — no bitrate choice. */
export type AudioQuality = 'best' | '320k' | '192k' | '128k'

/** Which subtitles to fetch alongside (or instead of) the media. */
export interface SubtitleOptions {
  /** off = none; manual = uploaded by the creator; auto = YouTube's auto-generated; both = either. */
  mode: 'off' | 'manual' | 'auto' | 'both'
  /** Language codes as yt-dlp lists them, e.g. 'en', 'sv', 'en-orig'. */
  langs: string[]
  /** Embed into the video file (MP4/MKV/MOV) as well as saving .srt files. */
  embed: boolean
  /** Download only the subtitle files, no video/audio. */
  only?: boolean
}

/** Jobs started together share a batch, which the Library shows as one collapsible group. */
export interface BatchInfo {
  id: string
  label: string
  /** How many jobs the batch started (groups only form for 2 or more). */
  size: number
}

export interface DownloadRequest {
  /** Set by the card when it starts several jobs at once. */
  batch?: BatchInfo
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
  /** Only matters for a video link that also carries a playlist ("mixed" —
   *  see DownloadProbe.playlist.ambiguous): 'all' downloads the whole list,
   *  anything else just that video. Pure playlist links always download the lot. */
  playlist?: 'all' | 'single'
  /** For a list/channel/search: only the first N entries (omit for all; searches default to 20). */
  limit?: number
  subs?: SubtitleOptions
  /** Extra language audio tracks (dubbed audio) to save as separate MP3 files. */
  audioTracks?: string[]
  /** Internal: this job is one language track of a parent download. */
  audioLang?: string
}

export interface PlaylistInfo {
  title: string
  /** Number of videos in the playlist. */
  count: number
  /** True when the link is a single video that merely belongs to a playlist,
   *  so the user has to choose; false for a pure playlist link. */
  ambiguous: boolean
  /** What kind of list this is, when known. */
  type?: 'playlist' | 'channel' | 'search' | 'watchlater' | 'liked' | null
  /** True when the list needs a signed-in account and no cookie source is configured. */
  needsLogin?: boolean
}

export interface DownloadProbe {
  title: string
  approxSizeBytes: number | null
  thumbnailUrl: string | null
  /** Non-null when the link is (or contains) a YouTube playlist. */
  playlist?: PlaylistInfo | null
  /** Subtitle languages the video offers: uploaded by the creator vs auto-generated. */
  subtitleLangs?: string[]
  autoLangs?: string[]
  /** Language codes of separate audio tracks (dubbed audio), when the video has several. */
  audioLangs?: string[]
  /** '360' = spherical video, '3d' = stereoscopic. */
  flags?: Array<'360' | '3d'>
}

/** Settings the main process reads itself (see electron/settings.cjs). */
export interface AppSettings {
  /** '' = no proxy; otherwise an http(s)/socks4/socks5 URL used for every yt-dlp call. */
  proxy: string
  cookies: {
    mode: 'none' | 'browser' | 'file' | 'login'
    browser: string
    /** Optional browser profile name or absolute folder. */
    profile: string
    file: string
  }
}

/** Output format for the Converter: video containers, audio formats and image
 *  formats. Each has one fixed default codec/quality — see electron/main.cjs. */
export type ContainerFormat =
  | 'MP4' | 'MKV' | 'WEBM' | 'MOV' | 'AVI' | 'GIF'
  | 'MP3' | 'FLAC' | 'WAV' | 'OGG' | 'M4A' | 'OPUS'
  | 'PDF' | 'DOCX' | 'ODT' | 'RTF' | 'TXT' | 'HTML'
  | 'PNG' | 'JPG' | 'WEBP' | 'AVIF' | 'BMP' | 'TIFF' | 'ICO'

/** 'remux' = stream copy, no re-encode (fast, only works if the source codec fits the
 *  container). 'transcode' = re-encode with a fixed default codec per container. */
export type ConvertMode = 'remux' | 'transcode'

export interface ConvertRequest {
  /** Set by the card when it starts several jobs at once. */
  batch?: BatchInfo
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
  /** Set by the card when it starts several jobs at once. */
  batch?: BatchInfo
  inputPath: string
  scale: UpscaleScale
  model: UpscaleModel
  /** Overrides the Settings default destination for this one job. */
  destination?: string
}

/** How much to multiply the source frame rate by — 2x doubles it, 4x quadruples it. */
export type InterpolateMultiplier = 2 | 4

export interface InterpolateRequest {
  /** Set by the card when it starts several jobs at once. */
  batch?: BatchInfo
  inputPath: string
  multiplier: InterpolateMultiplier
  /** Overrides the Settings default destination for this one job. */
  destination?: string
}

/** faster-whisper model sizes — bigger is more accurate and slower. Each downloads once on first use. */
export type WhisperModel = 'tiny' | 'base' | 'small' | 'medium'
export type SubtitleFormat = 'srt' | 'vtt'

/** no-vocals = instrumental; vocals = isolated voice / background music removed; voice = vocals
 *  plus speech cleanup; echo = basic ffmpeg echo & noise reduction (no AI model). */
export type AudioAiMode = 'no-vocals' | 'vocals' | 'voice' | 'echo'
export type AudioAiFormat = 'MP3' | 'FLAC' | 'WAV'

export interface AudioAiRequest {
  /** Set by the card when it starts several jobs at once. */
  batch?: BatchInfo
  inputPath: string
  mode: AudioAiMode
  /** Output audio format (ignored when keepVideo produces an MP4). */
  format: AudioAiFormat
  /** For video inputs: put the processed audio back onto the original picture (MP4). */
  keepVideo?: boolean
  /** Overrides the Settings default destination for this one job. */
  destination?: string
}

export interface SubtitlesRequest {
  /** Set by the card when it starts several jobs at once. */
  batch?: BatchInfo
  inputPath: string
  model: WhisperModel
  /** 'auto' to let Whisper detect it, otherwise an ISO 639-1 code like 'en'. */
  language: string
  format: SubtitleFormat
  /** Overrides the Settings default destination for this one job. */
  destination?: string
}

export type TaskKind = 'download' | 'convert' | 'upscale' | 'interpolate' | 'subtitles' | 'audio-ai'
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
  /** Set while a whole-playlist download runs: which video it's on. total is 0
   *  until yt-dlp reports it. Absent for ordinary single-video tasks. */
  playlist?: { index: number; total: number } | null
  /** When the task was created (ms since epoch). Missing on very old history entries. */
  createdAt?: number
  /** Batch this task belongs to, if it was started together with others. */
  group?: BatchInfo | null
}

export interface SubscriptionInput {
  /** Channel or playlist link. */
  url: string
  format: DownloadFormat
  videoQuality?: VideoQuality
  audioQuality?: AudioQuality
  /** Folder to save into; empty = a folder named after the subscription inside the default download folder. */
  destination?: string
  /** Also download this many of the newest videos right now (0 = only future uploads). */
  backfill?: number
}

export interface Subscription {
  id: string
  url: string
  title: string
  format: DownloadFormat
  videoQuality?: VideoQuality
  audioQuality?: AudioQuality
  destination: string
  enabled: boolean
  createdAt: number
  lastCheckedAt: number | null
  lastResult: { ok: boolean; started: number; error: string | null } | null
}

/** One entry from a Library export: the finished task plus the request that produced it. */
export interface ImportedTask {
  channel: string
  req: Record<string, unknown>
  state: TaskState
}

export interface HostTasks {
  startDownload(req: DownloadRequest): Promise<string>
  startConvert(req: ConvertRequest): Promise<string>
  startUpscale(req: UpscaleRequest): Promise<string>
  startVideoUpscale(req: UpscaleRequest): Promise<string>
  startInterpolate(req: InterpolateRequest): Promise<string>
  startSubtitles(req: SubtitlesRequest): Promise<string>
  startAudioAi(req: AudioAiRequest): Promise<string>
  cancel(taskId: string): void
  /** Replays a finished task's original request as a new task. Resolves to the new id (null if it can't be replayed). */
  rerun(taskId: string): Promise<string | null>
  /** Reveals a finished task's output (or its destination folder) in the file manager. */
  openFolder(taskId: string): Promise<void>
  /** Removes every finished/failed/canceled task from the history. */
  clearFinished(): Promise<void>
  /** Removes specific finished tasks (running ones are ignored). Resolves to how many went. */
  remove(ids: string[]): Promise<number>
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
  /** Filesystem path of a File dropped onto the window ('' when unavailable, e.g. in a browser). */
  pathForFile(file: File): string
  /** yt-dlp isn't bundled — checks whether it's on PATH, with an install hint if not. */
  checkYtDlp(): Promise<ToolStatus>
  /** ffmpeg isn't bundled either — same check, for the Converter. */
  checkFfmpeg(): Promise<ToolStatus>
  /** LibreOffice (soffice) powers the Converter's document formats. */
  checkLibreOffice(): Promise<ToolStatus>
  /** realesrgan-ncnn-vulkan isn't bundled either, and unlike yt-dlp/ffmpeg it's
   *  essentially never pre-installed — same check shape, for the Image Upscaler. */
  checkRealesrgan(): Promise<ToolStatus>
  /** rife-ncnn-vulkan isn't bundled either — same check shape, for Frame Interpolation. */
  checkRife(): Promise<ToolStatus>
  /** faster-whisper is a Python library — checks the user's Python can import it, for Subtitles. */
  checkFasterWhisper(): Promise<ToolStatus>
  /** Python with torch + demucs + soundfile, for the AI Audio card. */
  checkDemucs(): Promise<ToolStatus>
  tasks: HostTasks
  /** Update check against GitHub releases. Desktop shell only (notify-only: opens the release page). */
  updates?: {
    check(): Promise<UpdateCheck>
    openRelease(url: string): Promise<void>
  }
  /** Present only on hosts that can see the OS-level Omarchy theme (Electron
   *  on Linux); undefined everywhere else, including a non-Omarchy Linux
   *  desktop that just happens to run Electron. */
  /** Main-process settings (proxy, login cookies). Desktop shell only. */
  settings?: {
    get(): Promise<AppSettings>
    set(patch: { proxy?: string; cookies?: Partial<AppSettings['cookies']> }): Promise<AppSettings>
  }
  /** Auto-download new uploads from a channel/playlist (checked while the app is open). Desktop shell only. */
  subscriptions?: {
    list(): Promise<Subscription[]>
    add(input: SubscriptionInput): Promise<Subscription>
    remove(id: string): Promise<void>
    setEnabled(id: string, enabled: boolean): Promise<void>
    /** Checks one subscription (or all) now. Resolves to how many downloads it started. */
    checkNow(id?: string): Promise<{ started: number; busy: boolean }>
    /** Fires whenever the list changes (a check ran, one was added/removed). */
    subscribe(listener: (list: Subscription[]) => void): () => void
  }
  /** Library export/import (JSON). Desktop shell only. */
  library?: {
    /** Saves finished tasks to a file the user picks. */
    exportHistory(): Promise<{ ok: boolean; count: number; path?: string }>
    /** Opens a file picker and returns the validated entries it holds (nothing is added yet). */
    importHistory(): Promise<{ ok: boolean; entries: ImportedTask[]; error?: string }>
    /** Adds the entries to the history, or (run) starts each one as a new job. */
    importApply(entries: ImportedTask[], run: boolean): Promise<{ added: number; started: number }>
  }
  /** The built-in sign-in window and cookie test. Desktop shell only. */
  login?: {
    /** Opens the sign-in window; resolves when the user closes it, with how many cookies were saved. */
    open(url?: string): Promise<{ ok: boolean; cookies: number; error?: string }>
    status(): Promise<{ signedIn: boolean; cookies: number; updatedAt: number | null }>
    /** Signs out: forgets the window's session and deletes the saved cookie file. */
    clear(): Promise<void>
    /** Tries to read the signed-in-only Watch Later list with the current cookie source. */
    test(): Promise<{ ok: boolean; message: string }>
  }
  omarchy?: {
    /** Current Omarchy theme, or null if Omarchy isn't installed/detected. */
    get(): Promise<OmarchyTheme | null>
    /** Fires on every live Omarchy theme change. Returns an unsubscribe fn. */
    subscribe(listener: (theme: OmarchyTheme | null) => void): () => void
  }
}

export interface UpdateCheck {
  /** Version of the running app. */
  current: string
  latest: { tag: string; name: string; url: string; notes: string } | null
  /** True when `latest` has a higher version number than `current`. */
  newer: boolean
  /** Set when GitHub couldn't be reached. */
  error: string | null
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
  startAudioAi: async (req) => {
    const id = crypto.randomUUID()
    browserTaskList = [
      {
        id,
        kind: 'audio-ai',
        status: 'error',
        progress: 0,
        label: 'AI audio tools require the desktop app',
        error: 'Desktop app required',
        format: req.format,
        quality: req.mode,
        sizeBytes: null,
        sizeIsEstimate: false,
        thumbnailUrl: null,
        experimentalMatch: null,
      },
    ]
    browserListeners.forEach((l) => l(browserTaskList))
    return id
  },
  startSubtitles: async (req) => {
    const id = crypto.randomUUID()
    browserTaskList = [
      {
        id,
        kind: 'subtitles',
        status: 'error',
        progress: 0,
        label: 'Subtitles require the desktop app',
        error: 'Desktop app required',
        format: req.format.toUpperCase(),
        quality: `Whisper ${req.model}`,
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
  rerun: async () => null,
  openFolder: async () => {},
  clearFinished: async () => {},
  remove: async () => 0,
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
  pathForFile: () => '',
  pickFolder: async () => null,
  checkYtDlp: async () => ({ available: false, installHint: 'Desktop app required' }),
  checkFfmpeg: async () => ({ available: false, installHint: 'Desktop app required' }),
  checkLibreOffice: async () => ({ available: false, installHint: 'Desktop app required' }),
  checkRealesrgan: async () => ({ available: false, installHint: 'Desktop app required' }),
  checkRife: async () => ({ available: false, installHint: 'Desktop app required' }),
  checkFasterWhisper: async () => ({ available: false, installHint: 'Desktop app required' }),
  checkDemucs: async () => ({ available: false, installHint: 'Desktop app required' }),
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
