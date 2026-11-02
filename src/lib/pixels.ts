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

/** 5×7 bitmap letters for the pixel wordmark. */
const GLYPHS: Record<string, string[]> = {
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  N: ['10001', '11001', '10101', '10101', '10011', '10001', '10001'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
}

export interface PixelCell {
  x: number
  y: number
  row: number
}

/** The filled cells of `text` (letters one cell apart) and the grid size they span. */
export function pixelText(text: string): { cells: PixelCell[]; cols: number; rows: number } {
  const cells: PixelCell[] = []
  let x = 0
  for (const ch of text.toUpperCase()) {
    GLYPHS[ch]?.forEach((line, row) => {
      for (let col = 0; col < 5; col++) if (line[col] === '1') cells.push({ x: x + col, y: row, row })
    })
    x += 6
  }
  return { cells, cols: Math.max(x - 1, 1), rows: 7 }
}

/** A repeatable scatter of squares, thicker toward the left and right edges. */
export function pixelScatter(cols: number, rows: number, seedValue = 7): { x: number; y: number; opacity: number }[] {
  let seed = Math.max(1, Math.floor(seedValue) % 2147483647)
  const rnd = () => {
    seed = (seed * 16807) % 2147483647
    return seed / 2147483647
  }
  const out: { x: number; y: number; opacity: number }[] = []
  for (let i = 0; i < cols * rows * 0.07; i++) {
    const x = Math.floor(rnd() * cols)
    const y = Math.floor(rnd() * rows)
    const edge = Math.abs(x - cols / 2) / (cols / 2)
    // Denser toward the sides, but the middle gets some too (fainter, so it never fights the content).
    if (rnd() > 0.2 + edge * edge * 0.7) continue
    out.push({ x, y, opacity: (0.06 + rnd() * 0.16) * (0.55 + 0.45 * edge) })
  }
  return out
}
