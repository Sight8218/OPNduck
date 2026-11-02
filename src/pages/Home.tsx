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


import PixelLogo from '../components/PixelLogo'
import AdaptiveCardGrid from '../components/AdaptiveCardGrid'
import InboxBanner from '../components/InboxBanner'

export default function Home() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <h1 className="mb-6" aria-label="OPNduck">
        <PixelLogo cell={6} banded />
      </h1>

      <InboxBanner />
      <AdaptiveCardGrid />
    </div>
  )
}