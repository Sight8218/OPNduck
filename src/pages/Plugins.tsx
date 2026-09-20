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


export default function Plugins() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <h1 className="mb-1 text-2xl font-extrabold sm:text-3xl">Plugins</h1>
      <p className="mb-6 text-sm text-[var(--text-dim)]">
        Community-created modules for OPNduck.
      </p>

      <div className="glass flex flex-col items-center gap-2 rounded-3xl p-10 text-center text-sm text-[var(--text-dim)]">
        <p>
          Dynamic loading opens with the Desktop (Tauri) phase — but the plugin
          manifest format is locked now, so you can start building today.
        </p>
        <a
          href="https://github.com/Sight8218/OPNduck/blob/main/PLUGINS.md"
          target="_blank"
          rel="noreferrer"
          className="font-semibold text-[var(--accent)] underline underline-offset-2"
        >
          Read the plugin authoring guide →
        </a>
      </div>
    </div>
  )
}