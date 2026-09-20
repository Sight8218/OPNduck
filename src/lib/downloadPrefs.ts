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

// @category: settings/storage-performance
const STORAGE_KEY = 'opnduck.downloadDir'

/** User-chosen override for the default download folder, or null to use the platform default. */
export function getDownloadDirOverride(): string | null {
  return localStorage.getItem(STORAGE_KEY)
}

export function setDownloadDirOverride(dir: string | null): void {
  if (dir) localStorage.setItem(STORAGE_KEY, dir)
  else localStorage.removeItem(STORAGE_KEY)
}
// --- end: settings/storage-performance ---
