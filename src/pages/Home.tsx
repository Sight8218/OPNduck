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


import AdaptiveCardGrid from '../components/AdaptiveCardGrid'

export default function Home() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <div className="mb-8">
        <h1 className="text-2xl font-extrabold sm:text-3xl">Welcome to OPNduck</h1>
        <p className="mt-1 text-sm text-[var(--text-dim)]">
          Your local-first media processing workspace. Tools below are generated from your
          installed features and plugins — installing one adds a card here automatically.
        </p>
      </div>

      <AdaptiveCardGrid />
    </div>
  )
}