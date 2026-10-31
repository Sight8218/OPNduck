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

import { pixelText } from '../lib/pixels'

const BANDS = [78, 62, 50, 40, 30, 22, 14] // % of the text colour mixed into the accent, top row to bottom row

/**
 * The OPNduck wordmark in blocky pixel letters. `banded` shades the rows from light to dark in
 * the accent colour; otherwise it is one flat accent colour.
 */
export default function PixelLogo({ cell = 3, banded = false, className = '' }: { cell?: number; banded?: boolean; className?: string }) {
  const { cells, cols, rows } = pixelText('OPNDUCK')
  return (
    <svg
      role="img"
      aria-label="OPNduck"
      viewBox={`0 0 ${cols} ${rows}`}
      width={cols * cell}
      height={rows * cell}
      shapeRendering="crispEdges"
      className={className}
    >
      {cells.map((c) => (
        <rect
          key={`${c.x}-${c.y}`}
          x={c.x}
          y={c.y}
          width="1"
          height="1"
          fill={banded ? `color-mix(in srgb, var(--text) ${BANDS[c.row]}%, var(--accent))` : 'var(--accent)'}
        />
      ))}
    </svg>
  )
}
