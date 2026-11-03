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

/** Where a tool's jobs run, chosen on its card: "default" follows Settings > Servers, "local" is this PC, anything else is a server id. */
export const FEATURE_KIND: Record<string, string> = {
  downloader: 'download',
  converter: 'convert',
  'image-upscaler': 'upscale_image',
  'video-upscaler': 'upscale_video',
  'frame-interpolation': 'interpolate',
  subtitles: 'subtitles',
  'audio-ai': 'audio_ai',
  trim: 'trim',
  compress: 'compress',
  gif: 'make_gif',
  jumpcut: 'jump_cut',
  restore: 'restore',
}

const key = (kind: string) => `opnduck:runOn:${kind}`

export function getRunOn(kind: string): string {
  try {
    return localStorage.getItem(key(kind)) || 'default'
  } catch {
    return 'default'
  }
}

export function setRunOn(kind: string, where: string): void {
  try {
    if (where === 'default') localStorage.removeItem(key(kind))
    else localStorage.setItem(key(kind), where)
  } catch {
    /* storage unavailable: the Settings default applies */
  }
}

/** Adds the card's choice to a job request. Nothing is added for "default", so the Settings choice decides. */
export function withRunOn<T extends object>(kind: string, req: T): T & { runOn?: string } {
  const where = getRunOn(kind)
  return where === 'default' ? req : { ...req, runOn: where }
}
