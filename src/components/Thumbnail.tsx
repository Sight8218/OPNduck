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

import { useState } from 'react'

// @category: downloader/thumbnail
/** Video/audio thumbnail with a neutral placeholder while loading, missing, or broken. */
export default function Thumbnail({
  url,
  className,
}: {
  url: string | null | undefined
  className: string
}) {
  const [failed, setFailed] = useState(false)

  if (!url || failed) {
    return <div className={`${className} bg-[var(--input-bg)]`} />
  }
  return (
    <img
      src={url}
      alt=""
      aria-hidden="true"
      className={`${className} object-cover`}
      onError={() => setFailed(true)}
    />
  )
}
// --- end: downloader/thumbnail ---
