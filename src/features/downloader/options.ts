import type { AudioQuality, DownloadFormat, SubtitleOptions, VideoQuality } from '../../host'

/** Option lists shared by the Downloader card and the command palette's download panel. */
export const FORMAT_OPTIONS = (['MP4', 'MP3', 'MKV', 'MOV', 'FLAC', 'WAV'] as DownloadFormat[]).map((f) => ({
  value: f,
  label: f,
}))

export const VIDEO_QUALITY_OPTIONS: { value: VideoQuality; label: string }[] = [
  { value: 'best', label: 'Best available' },
  { value: '4320', label: '4320p (8K)' },
  { value: '2160', label: '2160p (4K)' },
  { value: '1440', label: '1440p' },
  { value: '1080', label: '1080p' },
  { value: '720', label: '720p' },
  { value: '480', label: '480p' },
  { value: '360', label: '360p' },
]

export const AUDIO_QUALITY_OPTIONS: { value: AudioQuality; label: string }[] = [
  { value: 'best', label: 'Best (VBR)' },
  { value: '320k', label: '320 kbps' },
  { value: '192k', label: '192 kbps' },
  { value: '128k', label: '128 kbps' },
]

export const VIDEO_FORMATS: DownloadFormat[] = ['MP4', 'MKV', 'MOV']

export const SUB_MODE_OPTIONS: { value: SubtitleOptions['mode']; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'manual', label: 'Uploaded' },
  { value: 'auto', label: 'Auto' },
  { value: 'both', label: 'Both' },
]

/** "First N" choices for lists/channels (searches default to 20 and never exceed 100). */
export const LIMIT_OPTIONS: { value: string; label: string }[] = [
  { value: 'all', label: 'All videos' },
  { value: '10', label: 'First 10' },
  { value: '25', label: 'First 25' },
  { value: '50', label: 'First 50' },
  { value: '100', label: 'First 100' },
]
export const SEARCH_LIMIT_OPTIONS = LIMIT_OPTIONS.filter((o) => o.value !== 'all').map((o) =>
  o.value === '25' ? { value: '20', label: 'First 20' } : o,
)

/** Everything a preset / Smart Mode remembers about a download setup. */
export interface DownloaderPrefs {
  format: DownloadFormat
  videoQuality: VideoQuality
  audioQuality: AudioQuality
  subMode: SubtitleOptions['mode']
  subLangs: string[]
  subEmbed: boolean
  subOnly: boolean
}

export const DEFAULT_PREFS: DownloaderPrefs = {
  format: 'MP4',
  videoQuality: 'best',
  audioQuality: 'best',
  subMode: 'off',
  subLangs: [],
  subEmbed: false,
  subOnly: false,
}

/** Presets saved before subtitles existed lack the new fields; fill them from defaults. */
export function normalizePrefs(p: Partial<DownloaderPrefs> | null | undefined): DownloaderPrefs {
  return { ...DEFAULT_PREFS, ...(p ?? {}), subLangs: Array.isArray(p?.subLangs) ? p.subLangs : [] }
}

/** Human name for a language code ('en' → 'English', 'en-orig' → 'English (original)'). */
export function languageLabel(code: string): string {
  const base = code.replace(/-orig$/, '')
  let name = code
  try {
    name = new Intl.DisplayNames(['en'], { type: 'language' }).of(base) ?? code
  } catch {
    /* unknown code — show it raw */
  }
  return code.endsWith('-orig') ? `${name} (original)` : name
}
