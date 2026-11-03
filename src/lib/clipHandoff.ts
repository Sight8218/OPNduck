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
 * A clip picked in one card, waiting for another to take it (the trimmer's "Make a GIF or sticker of this part"
 * button hands its file and times to the GIF card). Module-level on purpose: it is read once and cleared.
 */
export interface ClipHandoff {
  file: string
  start: number
  end: number
}

let pending: ClipHandoff | null = null

export const setClipHandoff = (clip: ClipHandoff) => {
  pending = clip
}

/** A moment in a video waiting for the Trim card to open its visual trimmer there (from a spoken-words search hit). */
let pendingTrim: ClipHandoff | null = null
export const setTrimHandoff = (clip: ClipHandoff) => {
  pendingTrim = clip
}
export function takeTrimHandoff(): ClipHandoff | null {
  const clip = pendingTrim
  pendingTrim = null
  return clip
}

export function takeClipHandoff(): ClipHandoff | null {
  const clip = pending
  pending = null
  return clip
}
