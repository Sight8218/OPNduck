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
 * The vibrant fluid gradient background layer.
 * Rendered behind everything (z-index -2), animated warm blobs.
 * Automatically deactivates (opacity 0) in flat / monochrome themes.
 */
export default function FluidBackground() {
  return (
    <div className="fluid-background" aria-hidden="true">
      <div className="fluid-blob fluid-blob-1" />
      <div className="fluid-blob fluid-blob-2" />
      <div className="fluid-blob fluid-blob-3" />
      <div className="fluid-blob fluid-blob-4" />
      <div className="fluid-blob fluid-blob-5" />
      <div className="fluid-blob fluid-blob-6" />
      <div className="fluid-scrim" />
    </div>
  )
}
