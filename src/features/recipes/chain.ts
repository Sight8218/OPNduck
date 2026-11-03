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

// What each step takes and gives, mirrored from STEP_TYPES / producesFor in electron/mcp_tools.cjs so the editor can
// offer only steps that fit. The app checks the chain again when it is saved, and that check is the authority.
const AUDIO = ['MP3', 'FLAC', 'WAV', 'OGG', 'M4A', 'OPUS']
const IMAGE = ['PNG', 'JPG', 'WEBP', 'AVIF', 'BMP', 'TIFF', 'ICO']
const DOCUMENT = ['PDF', 'DOCX', 'ODT', 'RTF', 'TXT', 'HTML']

export type DataType = 'url' | 'video' | 'audio' | 'image' | 'subtitle' | 'document'

export function producesFor(tool: string, args: Record<string, unknown>, input: DataType): DataType {
  switch (tool) {
    case 'download':
      return AUDIO.includes(String(args.format ?? 'MP4').toUpperCase()) ? 'audio' : 'video'
    case 'convert':
      return AUDIO.includes(String(args.container)) ? 'audio' : IMAGE.includes(String(args.container)) ? 'image' : DOCUMENT.includes(String(args.container)) ? 'document' : 'video'
    case 'upscale_image':
    case 'make_gif':
      return 'image'
    case 'upscale_video':
    case 'interpolate':
      return 'video'
    case 'subtitles':
      return 'subtitle'
    case 'tag_music':
    case 'audio_ai':
      return 'audio'
    case 'jump_cut':
      return args.audioOnly ? 'audio' : input
    default:
      return input // trim, compress: same kind of file out as in
  }
}

/** The kind of file after each step, starting from the recipe's input (the first entry). */
export function typesAlong(input: DataType, steps: { tool: string; args: Record<string, unknown> }[]): DataType[] {
  const out: DataType[] = [input]
  for (const s of steps) out.push(producesFor(s.tool, s.args, out[out.length - 1]))
  return out
}

export const TITLES: Record<string, string> = {
  download: 'Download',
  convert: 'Convert',
  upscale_image: 'Upscale image',
  upscale_video: 'Upscale video',
  interpolate: 'Smooth motion (interpolate)',
  subtitles: 'Subtitles',
  trim: 'Trim',
  compress: 'Compress to a size',
  make_gif: 'GIF or sticker',
  jump_cut: 'Jump cut and normalize',
  tag_music: 'Tag music',
  audio_ai: 'AI audio',
}
