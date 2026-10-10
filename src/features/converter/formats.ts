import type { ContainerFormat } from '../../host'

export type FormatCategory = 'video' | 'audio' | 'image'

export interface FormatInfo {
  id: ContainerFormat
  label: string
  category: FormatCategory
  /** One-line hint shown under the tile. */
  hint: string
}

export const FORMATS: FormatInfo[] = [
  { id: 'MP4', label: 'MP4', category: 'video', hint: 'Plays everywhere' },
  { id: 'MKV', label: 'MKV', category: 'video', hint: 'Many tracks, subtitles' },
  { id: 'WEBM', label: 'WebM', category: 'video', hint: 'Web / VP9' },
  { id: 'MOV', label: 'MOV', category: 'video', hint: 'Apple / editing' },
  { id: 'AVI', label: 'AVI', category: 'video', hint: 'Legacy players' },
  { id: 'GIF', label: 'GIF', category: 'video', hint: 'Looping animation' },
  { id: 'MP3', label: 'MP3', category: 'audio', hint: 'Universal, lossy' },
  { id: 'FLAC', label: 'FLAC', category: 'audio', hint: 'Lossless' },
  { id: 'WAV', label: 'WAV', category: 'audio', hint: 'Uncompressed' },
  { id: 'OGG', label: 'OGG', category: 'audio', hint: 'Vorbis, open' },
  { id: 'M4A', label: 'M4A', category: 'audio', hint: 'AAC, Apple' },
  { id: 'OPUS', label: 'Opus', category: 'audio', hint: 'Best at low bitrate' },
  { id: 'PNG', label: 'PNG', category: 'image', hint: 'Lossless, transparency' },
  { id: 'JPG', label: 'JPG', category: 'image', hint: 'Small photos' },
  { id: 'WEBP', label: 'WebP', category: 'image', hint: 'Small, modern' },
  { id: 'AVIF', label: 'AVIF', category: 'image', hint: 'Smallest, modern' },
  { id: 'BMP', label: 'BMP', category: 'image', hint: 'Uncompressed' },
  { id: 'TIFF', label: 'TIFF', category: 'image', hint: 'Print / archive' },
  { id: 'ICO', label: 'ICO', category: 'image', hint: 'Icons, up to 256px' },
]

export const CATEGORY_LABELS: Record<FormatCategory, string> = {
  video: 'Video',
  audio: 'Audio',
  image: 'Image',
}

const VIDEO_EXT = ['mp4', 'mkv', 'mov', 'webm', 'avi', 'flv', 'm4v', 'wmv', 'ts', 'mpg', 'mpeg', '3gp']
const AUDIO_EXT = ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'opus', 'wma']
const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'webp', 'avif', 'gif', 'bmp', 'tif', 'tiff', 'ico']

export const PICKER_EXTENSIONS = [...VIDEO_EXT, ...AUDIO_EXT, ...IMAGE_EXT]

export function fileCategory(path: string): FormatCategory | null {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  // A .gif can be treated as an image; it converts to other image formats.
  if (IMAGE_EXT.includes(ext)) return 'image'
  if (AUDIO_EXT.includes(ext)) return 'audio'
  if (VIDEO_EXT.includes(ext)) return 'video'
  return null
}

/** Which targets a source of this category can become. */
const TARGETS: Record<FormatCategory, FormatCategory[]> = {
  video: ['video', 'audio'], // audio = extract the soundtrack
  audio: ['audio'],
  image: ['image'],
}

export function canConvert(source: FormatCategory | null, target: FormatInfo): boolean {
  return source !== null && TARGETS[source].includes(target.category)
}
