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
 * OPNduck Host Interface: the one seam between the UI and the native shell. The React tree
 * calls only these functions for anything OS-related; each shell implements the same interface
 * (Electron adapter in src/host/electron.ts, plus a browser no-op fallback below).
 */

import { detectElectronHost } from './electron'
import type { OmarchyTheme } from '../themes/omarchySync'
import type { PluginManifest, PluginPermission } from '../features/registry'

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

/** Python tools OPNduck can install for you into its own environment. */
export type PythonTool = 'demucs' | 'whisper' | 'whisper-gpu' | 'torch'

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
  /** Write the cover art and title/artist tags into the file (MP3, FLAC, M4A-style audio, MP4, MKV). */
  embedMeta?: boolean
  /** Spotify matches only (internal): YouTube ids already tried and rejected, and the one picked. */
  matchExclude?: string[]
  matchedId?: string
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
export interface McpInfo {
  enabled: boolean
  running: boolean
  port: number | null
  /** The `claude mcp add ...` line that registers OPNduck with Claude Code. */
  claudeCommand: string
  /** The same server written for each kind of MCP client: a shell command to run, or JSON to paste into its config. */
  clients: { name: string; kind: 'command' | 'json'; text: string }[]
}

export interface AppSettings {
  /** '' = no proxy; otherwise an http(s)/socks4/socks5 URL used for every yt-dlp call. */
  proxy: string
  /** 'auto' = faster multi-threaded GPU jobs; 'low' = conservative, for GPUs with little memory. */
  gpuThreads: 'auto' | 'low'
  /** Video upscaling engine: 'auto' uses PyTorch when it can run (faster), 'ncnn' always uses the classic one. */
  upscaleEngine: 'auto' | 'ncnn'
  /** AI video encoder: 'auto' = GPU (NVENC) when it works, 'cpu' = x264. */
  videoEncoder: 'auto' | 'cpu'
  /** Desktop notification when jobs finish while the window isn't focused. */
  notifyOnFinish: boolean
  /** Parallel downloads (1-6) and conversions (1-4). */
  /** New media files in this folder are converted automatically (checked every 10 seconds while OPNduck runs). */
  watchFolder: { enabled: boolean; path: string; container: string }
  maxDownloads: number
  maxConversions: number
  /** Closing the window keeps OPNduck running in the system tray. */
  runInTray: boolean
  /** Local MCP server, so tools like Claude Code can start and watch jobs. */
  mcpServer: boolean
  /** Start with every plugin skipped (applies on the next start). */
  pluginsSafeMode: boolean
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

export type TrimMode = 'fast' | 'precise'

export type GifPreset = 'gif' | 'webp' | 'telegram' | 'discord'

export interface GifRequest {
  /** Set by the card when it starts several jobs at once. */
  batch?: BatchInfo
  inputPath: string
  preset: GifPreset
  /** Seconds from the start of the file. */
  start: number
  /** Seconds; null = as long as the preset allows. */
  end: number | null
  /** GIF and WebP only (stickers use their own size). */
  width?: number
  fps?: number
  loop?: boolean
  /** Overrides the Settings default destination for this one job. */
  destination?: string
}

export type AutoTool = 'upscale_image' | 'upscale_video' | 'interpolate' | 'convert' | 'compress' | 'subtitles'

/** What Auto decided: the settings to apply, why each was chosen, and things worth knowing about the file. */
export interface AutoSuggestion {
  settings: Record<string, string | number | boolean>
  reasons: { setting: string; value: unknown; because: string }[]
  notes: { level: 'info' | 'warn'; text: string }[]
}

/** What the music tagger knows or proposes about one song. */
export interface TagFields {
  title: string | null
  artist: string | null
  album: string | null
  year: number | null
  track: number | null
}

export interface TagLookup {
  path: string
  /** The tags the file has now. */
  current: TagFields & { hasCover: boolean }
  /** What the lookup found (null = nothing). */
  found: (TagFields & { coverUrl?: string; releaseId?: string | null }) | null
  /** 0 to 1. */
  confidence: number
  source: 'acoustid' | 'filename' | 'none'
}

export interface TagRequest {
  /** Set by the card when it starts several jobs at once. */
  batch?: BatchInfo
  inputPath: string
  /** The tags the user reviewed. Without them the job looks the file up itself and writes only a sure match. */
  tags?: Partial<TagFields> & { coverUrl?: string }
  /** Also move the file to Artist/Album/ next to where it is. */
  organize?: boolean
  /** With no \`tags\`: how sure the match must be, 0.5 to 1 (default 0.9). */
  minConfidence?: number
}

export type CompressQuality = 'fast' | 'best'

export interface CompressRequest {
  /** Set by the card when it starts several jobs at once. */
  batch?: BatchInfo
  inputPath: string
  /** The size to stay under, in megabytes. */
  targetMB: number
  /** 'fast' uses the GPU encoder when there is one; 'best' is a slower two-pass x264 encode. */
  quality: CompressQuality
  /** Overrides the Settings default destination for this one job. */
  destination?: string
}

export interface TrimRequest {
  /** Set by the card when it starts several jobs at once. */
  batch?: BatchInfo
  inputPath: string
  /** Seconds from the start of the file. */
  start: number
  /** Seconds; null = to the end. */
  end: number | null
  /** 'fast' copies the streams (instant, but cuts land on keyframes); 'precise' re-encodes for exact cuts. */
  mode: TrimMode
  /** Overrides the Settings default destination for this one job. */
  destination?: string
}

export interface MediaInfo {
  duration: number
  width: number | null
  height: number | null
  hasVideo: boolean
  /** Present when the desktop app probed the file (the compressor uses these). */
  hasAudio?: boolean
  fps?: number | null
  bitrate?: number | null
}

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
  /** Write the subtitles translated to English instead of in the spoken language (Whisper only translates into English). */
  translate?: boolean
  format: SubtitleFormat
  /** Overrides the Settings default destination for this one job. */
  destination?: string
}

export type TaskKind = 'download' | 'convert' | 'upscale' | 'interpolate' | 'subtitles' | 'audio-ai' | 'trim' | 'compress' | 'tag' | 'gif'
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
  /** 'mcp' when an MCP client (not this window) started the job. */
  source?: 'mcp'
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
  startTrim(req: TrimRequest): Promise<string>
  startCompress(req: CompressRequest): Promise<string>
  startTag(req: TagRequest): Promise<string>
  startGif(req: GifRequest): Promise<string>
  cancel(taskId: string): void
  /** Replays a finished task's original request as a new task. Resolves to the new id (null if it can't be replayed). */
  rerun(taskId: string, opts?: { anotherMatch?: boolean }): Promise<string | null>
  /** The tail of what a job's tools printed (kept in memory only, so history from earlier launches has none). */
  /** Moves a waiting job to the front of its queue. Resolves to false if it isn't waiting. */
  runNext(taskId: string): Promise<boolean>
  logs(taskId: string): Promise<string[]>
  /** Streams new log lines for a task while subscribed; `replaceLast` means the last shown line was updated in place. */
  watchLog(taskId: string, listener: (p: { lines: string[]; replaceLast: boolean }) => void): () => void
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
  /** yt-dlp only: its version, and whether it's OPNduck's own downloaded copy (vs. the system one). */
  version?: string
  managed?: boolean
  /** faster-whisper only: an NVIDIA GPU is present, and whether OPNduck's CUDA 12 libraries are installed. */
  nvidia?: boolean
  gpu?: boolean
}

export type PluginStatus = 'broken' | 'disabled' | 'needs-approval' | 'safe-mode' | 'starting' | 'running' | 'crashed'

/** One plugin as the host reports it: manifest, why it can't load (if so), and what the user has approved. */
export interface PluginSummary {
  id: string
  name: string
  manifest: PluginManifest | null
  errors: string[]
  status: PluginStatus
  enabled: boolean
  approved: PluginPermission[]
  /** Permissions the manifest asks for that the user has not been shown yet (new since the last approval). */
  pendingApproval: PluginPermission[]
  verified: boolean
  source: string
  lastError: string
}

/** One plugin in the store index. `installed` is the installed version ('' when not installed). */
export interface PluginStoreEntry {
  id: string
  name: string
  version: string
  author: string
  description: string
  repo: string
  permissions: PluginPermission[]
  network: string[]
  verified: boolean
  installed: string
  installedFrom: string
}

export interface PluginStoreList {
  entries: PluginStoreEntry[]
  fetchedAt: number
  /** True when the index could not be fetched and the saved copy (or nothing) is shown. */
  offline: boolean
  error: string
}

export interface HostPlugins {
  list(): Promise<PluginSummary[]>
  /** Turns a plugin on with the permissions the user approved (a subset of what it asks for). */
  enable(id: string, approved: PluginPermission[]): Promise<PluginSummary>
  disable(id: string): Promise<PluginSummary>
  /** Stops the plugin and deletes its folder. */
  remove(id: string): Promise<void>
  /** Re-reads the plugins folder. */
  rescan(): Promise<PluginSummary[]>
  /** The store index with what is installed. Cached for an hour unless `force`. */
  storeList(force?: boolean): Promise<PluginStoreList>
  /** Downloads, checks the SHA-256 and installs a store plugin. It lands off; turn it on from Installed. */
  storeInstall(id: string): Promise<PluginSummary>
  openFolder(): Promise<void>
  /** A plugin card's call into the host. Only the card-safe part of the plugin API answers. */
  call(id: string, method: string, args: unknown[]): Promise<unknown>
  /** Fires when any plugin's status changes. Returns an unsubscribe function. */
  onChanged(listener: () => void): () => void
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
  /** Downloads (or updates) OPNduck's own yt-dlp copy, checksum-verified. */
  installYtDlp(): Promise<{ ok: boolean; error?: string }>
  /** ffmpeg isn't bundled either — same check, for the Converter. */
  checkFfmpeg(): Promise<ToolStatus>
  /** The music tagger needs Chromaprint's fpcalc. */
  checkFpcalc(): Promise<ToolStatus>
  /** Measures a file and suggests settings for a tool, with the reason for each (reads the file; starts no job). */
  suggestSettings(tool: AutoTool, filePath: string, opts?: { container?: string }): Promise<AutoSuggestion>
  /** Music tagger lookups. They contact AcoustID, MusicBrainz and the Cover Art Archive, only when called. */
  tagger: {
    identify(filePath: string): Promise<TagLookup>
    /** The audio files in a folder (and one level of subfolders). */
    listAudio(folder: string): Promise<string[]>
  }
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
  /** Duration and size of a media file (ffprobe). Null if it can't be read. */
  probeMedia(path: string): Promise<MediaInfo | null>
  /** One frame of a video at `time` seconds as an image data URL (null if it can't be read). */
  mediaFrame(path: string, time: number, width?: number): Promise<string | null>
  /** Evenly spaced small frames across a video, for a timeline strip (entries can be null). */
  mediaThumbs(path: string, duration: number, count?: number): Promise<(string | null)[]>
  /** The faster PyTorch video upscaling engine: whether it can run, and whether an NVIDIA GPU is present. */
  checkTorchEngine(): Promise<{ available: boolean; nvidia: boolean }>
  /** One-click install of a Python tool into OPNduck's own environment; `onProgress` gets pip's output lines. */
  installTool(tool: PythonTool, onProgress?: (line: string) => void): Promise<{ ok: boolean; error?: string }>
  cancelInstall(): Promise<void>
  tasks: HostTasks
  /** Update check against GitHub releases. Desktop shell only (notify-only: opens the release page). */
  updates?: {
    check(): Promise<UpdateCheck>
    openRelease(url: string): Promise<void>
  }
  /** Developer utilities (Settings, dev mode on). Desktop shell only. */
  dev?: {
    /** Tells the desktop shell whether Developer mode is on; its dev:* channels refuse to run while it is off. */
    setEnabled(on: boolean): Promise<void>
    info(): Promise<Record<string, Record<string, string | number | boolean>>>
    metrics(): Promise<{ pid: number; type: string; cpu: number; memMB: number }[]>
    logs(): Promise<{ t: number; level: string; text: string }[]>
    tasks(): Promise<unknown[]>
    /** A redacted report (versions, tools, settings, recent log) ready to paste into a bug report. */
    diagnostics(): Promise<string>
    openUserData(): Promise<string>
    toggleDevTools(): Promise<void>
    reloadUI(): Promise<void>
    testNotification(): Promise<boolean>
    /** Starts a simulated job (no real work) to try the UI; `fail` makes it error out. Resolves to its task id. */
    fakeJob(fail?: boolean): Promise<string>
    /** Forgets the remembered engine checks (PyTorch, Demucs, Whisper) so the next check runs for real. */
    clearEngineCache(): Promise<void>
    /** Recent IPC calls: channel, duration, error (arguments are never recorded). */
    ipc(): Promise<{ t: number; channel: string; ms: number; error: string | null }[]>
    /** The saved settings (redacted) and where the file lives. */
    settings(): Promise<{ path: string; json: string }>
    showSettingsFile(): Promise<void>
    /** Job start channels a raw request can be sent to. */
    jobChannels(): Promise<string[]>
    /** Starts a job from a raw request, with the same validation as the UI. Resolves to the task id. */
    startJob(channel: string, req: unknown): Promise<string>
    /** Creates a small sample file with ffmpeg and resolves to its path. */
    makeTestMedia(kind: 'video' | 'audio' | 'image'): Promise<string>
    /** Main-process event-loop delay since the last call, in ms. */
    loopLag(): Promise<{ meanMs: number; p99Ms: number; maxMs: number }>
  }
  /** Installed plugins (see PLUGINS.md and electron/core/plugins.cjs). Desktop shell only. */
  plugins?: HostPlugins
  /** The local MCP server (Settings → MCP server). Desktop shell only. */
  mcp?: {
    info(): Promise<McpInfo>
    resetToken(): Promise<McpInfo>
  }
  /** The job queue as a whole: pause starting new jobs (running ones finish). Desktop shell only. */
  queue?: {
    state(): Promise<{ paused: boolean }>
    setPaused(paused: boolean): Promise<void>
    subscribe(listener: (s: { paused: boolean }) => void): () => void
  }
  /** Main-process settings (proxy, login cookies). Desktop shell only. */
  settings?: {
    get(): Promise<AppSettings>
    set(patch: { proxy?: string; gpuThreads?: AppSettings['gpuThreads']; upscaleEngine?: AppSettings['upscaleEngine']; videoEncoder?: AppSettings['videoEncoder']; notifyOnFinish?: boolean; runInTray?: boolean; mcpServer?: boolean; pluginsSafeMode?: boolean; maxDownloads?: number; maxConversions?: number; watchFolder?: Partial<AppSettings['watchFolder']>; cookies?: Partial<AppSettings['cookies']> }): Promise<AppSettings>
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
  startTrim: async (req) => {
    const id = crypto.randomUUID()
    browserTaskList = [
      {
        id,
        kind: 'trim',
        status: 'error',
        progress: 0,
        label: 'Trimming requires the desktop app',
        error: 'Desktop app required',
        format: req.mode,
        quality: '',
        sizeBytes: null,
        sizeIsEstimate: false,
        thumbnailUrl: null,
        experimentalMatch: null,
      },
      ...browserTaskList,
    ]
    browserListeners.forEach((l) => l(browserTaskList))
    return id
  },
  startCompress: async (req) => {
    const id = crypto.randomUUID()
    browserTaskList = [
      {
        id,
        kind: 'compress',
        status: 'error',
        progress: 0,
        label: 'Compressing requires the desktop app',
        error: 'Desktop app required',
        format: `Under ${req.targetMB} MB`,
        quality: '',
        sizeBytes: null,
        sizeIsEstimate: false,
        thumbnailUrl: null,
        experimentalMatch: null,
      },
      ...browserTaskList,
    ]
    browserListeners.forEach((l) => l(browserTaskList))
    return id
  },
  startGif: async (req) => {
    const id = crypto.randomUUID()
    browserTaskList = [
      {
        id,
        kind: 'gif',
        status: 'error',
        progress: 0,
        label: 'Making a GIF requires the desktop app',
        error: 'Desktop app required',
        format: req.preset,
        quality: '',
        sizeBytes: null,
        sizeIsEstimate: false,
        thumbnailUrl: null,
        experimentalMatch: null,
      },
      ...browserTaskList,
    ]
    browserListeners.forEach((l) => l(browserTaskList))
    return id
  },
  startTag: async (req) => {
    const id = crypto.randomUUID()
    browserTaskList = [
      {
        id,
        kind: 'tag',
        status: 'error',
        progress: 0,
        label: 'Tagging requires the desktop app',
        error: 'Desktop app required',
        format: req.organize ? 'Organize' : '',
        quality: '',
        sizeBytes: null,
        sizeIsEstimate: false,
        thumbnailUrl: null,
        experimentalMatch: null,
      },
      ...browserTaskList,
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
  runNext: async () => false,
  logs: async () => [],
  watchLog: () => () => {},
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
  installYtDlp: async () => ({ ok: false, error: 'Desktop app required' }),
  checkFfmpeg: async () => ({ available: false, installHint: 'Desktop app required' }),
  checkFpcalc: async () => ({ available: false, installHint: 'Desktop app required' }),
  suggestSettings: async () => {
    throw new Error('Desktop app required')
  },
  tagger: {
    identify: async () => {
      throw new Error('Desktop app required')
    },
    listAudio: async () => [],
  },
  checkLibreOffice: async () => ({ available: false, installHint: 'Desktop app required' }),
  checkRealesrgan: async () => ({ available: false, installHint: 'Desktop app required' }),
  checkRife: async () => ({ available: false, installHint: 'Desktop app required' }),
  checkFasterWhisper: async () => ({ available: false, installHint: 'Desktop app required' }),
  checkDemucs: async () => ({ available: false, installHint: 'Desktop app required' }),
  checkTorchEngine: async () => ({ available: false, nvidia: false }),
  probeMedia: async () => null,
  mediaFrame: async () => null,
  mediaThumbs: async () => [],
  installTool: async () => ({ ok: false, error: 'Desktop app required' }),
  cancelInstall: async () => {},
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
