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

import { useMemo } from 'react'
import { pixelScatter } from '../lib/pixels'

const COLS = 107
const ROWS = 54

/** A faint scatter of accent-coloured squares along the top of every page. */
export default function PixelField() {
  const dots = useMemo(() => pixelScatter(COLS, ROWS), [])
  return (
    <svg
      aria-hidden="true"
      className="pixel-field"
      viewBox={`0 0 ${COLS} ${ROWS}`}
      preserveAspectRatio="xMidYMin slice"
      shapeRendering="crispEdges"
    >
      {dots.map((d, i) => (
        <rect key={i} x={d.x} y={d.y} width="1" height="1" opacity={d.opacity} />
      ))}
    </svg>
  )
}
