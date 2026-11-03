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
 * Tidier names for downloaded files: strips the clutter titles carry ("[Official Video]", "(4K)", "| Channel", ids,
 * hashtags), keeps "Artist - Title (Year)" shapes, and never touches the extension. Rules only; the person sees the
 * new name before anything is renamed. No Electron.
 */
const path = require('node:path')

const JUNK = /\s*[\[(（【](?:official\s*(?:music\s*)?(?:video|audio|lyric\s*video|visualizer|mv)?|lyrics?|lyric\s*video|audio|hd|hq|4k|8k|1080p|720p|60fps|remaster(?:ed)?(?:\s*\d{4})?|explicit|clean|full\s*(?:song|video|album)|music\s*video|with\s*lyrics|video\s*oficial|videoclip|visualiser)[^\])）】]*[\])）】]/gi

/** The title without the clutter; "" when nothing would be left. */
function cleanTitle(title) {
  let t = String(title ?? '').normalize('NFC')
  t = t.replace(JUNK, '')
  t = t.replace(/\s*[|｜]\s*[^|]*$/, (m) => (m.length <= 40 ? '' : m)) // "Title | Some Channel Name"
  t = t.replace(/\s+#\w+/g, '') // hashtags
  t = t.replace(/[\s_]+-[\s_]+/g, ' - ').replace(/_/g, ' ')
  t = t.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ') // characters that are not allowed in file names
  t = t.replace(/\s+\[[A-Za-z0-9_-]{8,14}\]$/, '') // a trailing [video id]
  t = t.replace(/\s{2,}/g, ' ').replace(/^[\s.-]+|[\s.-]+$/g, '').trim()
  return t.slice(0, 120)
}

/** The new file name for a file, or null when it is already tidy. The extension stays exactly as it is. */
function cleanFileName(fileName) {
  const ext = path.extname(fileName)
  const base = path.basename(fileName, ext)
  const clean = cleanTitle(base)
  if (!clean || clean === base) return null
  return `${clean}${ext}`
}

module.exports = { cleanTitle, cleanFileName }
