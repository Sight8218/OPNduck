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

// Time text helpers shared by the Trim card and its visual trimmer.

/** "1:23", "1:02:03", "83" or "83.5" → seconds (null if it isn't a time). */
export function parseTime(text: string): number | null {
  const parts = text.trim().split(':')
  if (!text.trim() || parts.length > 3 || parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) return null
  return parts.reduce((acc, p) => acc * 60 + Number(p), 0)
}

/** Seconds → "m:ss" / "h:mm:ss", with tenths when there are any. */
export function formatTime(sec: number): string {
  const t = Math.max(0, sec)
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const s = (t % 60).toFixed(t % 1 ? 1 : 0)
  return h ? `${h}:${String(m).padStart(2, '0')}:${s.padStart(s.includes('.') ? 4 : 2, '0')}` : `${m}:${s.padStart(s.includes('.') ? 4 : 2, '0')}`
}
