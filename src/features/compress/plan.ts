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

// A light copy of planBitrates / pickResolution from electron/core/compress.cjs, so the card can show an
// estimate before the job starts. The job does its own planning and is the authority; keep the two in step.
const OVERHEAD = 0.97
const MIN_VIDEO_KBPS = 80
const MIN_BPP = 0.05

export interface CompressEstimate {
  ok: boolean
  /** What the picture will be, e.g. "480p" or "720p · 30 fps". Empty for audio-only files. */
  label: string
  /** Shown when the target cannot be reached: the smallest size that can. */
  minMB?: number
}

export function estimateCompress(info: { duration: number; width: number | null; height: number | null; fps?: number | null; hasVideo: boolean; hasAudio?: boolean }, targetMB: number): CompressEstimate {
  const totalKbps = (targetMB * 1024 * 1024 * 8 * OVERHEAD) / info.duration / 1000
  if (!info.hasVideo) {
    return totalKbps < 24 ? { ok: false, label: '', minMB: (24 * 1000 * info.duration) / 8 / OVERHEAD / 1024 / 1024 } : { ok: true, label: `MP3 at ${Math.min(320, Math.floor(totalKbps))} kb/s` }
  }
  const audio = info.hasAudio === false ? 0 : totalKbps - 96 < 500 ? 64 : 96
  const video = Math.floor(totalKbps - audio)
  if (video < MIN_VIDEO_KBPS) {
    return { ok: false, label: '', minMB: ((MIN_VIDEO_KBPS + audio) * 1000 * info.duration) / 8 / OVERHEAD / 1024 / 1024 }
  }
  const w = info.width ?? 1920
  const h = info.height ?? 1080
  const fps = info.fps && info.fps > 0 ? info.fps : 30
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2)
  const steps = [...new Set([h, 1080, 720, 480, 360].filter((x) => x <= h))].sort((a, b) => b - a)
  const bpp = (height: number, f: number) => (video * 1000) / (even(height === h ? w : (height * w) / h) * even(height) * f)
  for (const f of fps > 30 ? [fps, 30] : [fps]) {
    for (const height of steps) {
      if (bpp(height, f) >= MIN_BPP) return { ok: true, label: `${height}p${f < fps - 0.5 ? ` · ${Math.round(f)} fps` : ''}` }
    }
  }
  return { ok: true, label: `${steps[steps.length - 1]}p${fps > 30 ? ' · 30 fps' : ''}` }
}
