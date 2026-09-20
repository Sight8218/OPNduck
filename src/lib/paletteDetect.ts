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

export type SmartKind = 'url' | 'video' | 'audio' | null

const VIDEO_EXT = ['mp4', 'mkv', 'mov', 'webm', 'avi', 'flv', 'm4v', 'wmv']
const AUDIO_EXT = ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a']

/** Live-detects what the command palette's query looks like, so it can swap
 *  from the normal search list to a quick-action panel as soon as you paste
 *  a link or a media file path. */
export function detectSmartKind(input: string): SmartKind {
  const trimmed = input.trim()
  if (!trimmed) return null
  if (/^(https?:\/\/|www\.)/i.test(trimmed)) return 'url'
  const ext = trimmed.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1]
  if (ext && VIDEO_EXT.includes(ext)) return 'video'
  if (ext && AUDIO_EXT.includes(ext)) return 'audio'
  return null
}
