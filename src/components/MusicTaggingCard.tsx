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

import { useEffect, useState } from 'react'
import { host, type AppSettings } from '../host'

// @category: settings/music-tagging
/** Settings > Music tagging: whether new audio downloads are looked up and tagged by themselves. Off by default. */
export default function MusicTaggingCard() {
  const [settings, setSettings] = useState<AppSettings | null>(null)

  useEffect(() => {
    host.settings?.get().then(setSettings)
  }, [])

  function change(autoTagAudio: boolean) {
    setSettings((s) => (s ? { ...s, autoTagAudio } : s))
    void host.settings?.set({ autoTagAudio })
  }
  if (!settings) return null

  return (
    <div className="glass rounded-3xl p-5">
      <h2 className="mb-1 text-base font-bold">Music tagging</h2>
      <p className="mb-2 text-xs text-[var(--text-dim)]">Fill in artist, title, album and cover art for your songs. You can always do it by hand in the Music Tagger.</p>
      <label className="flex cursor-pointer items-start gap-3 py-2">
        <input type="checkbox" className="mt-0.5 accent-[var(--accent)]" checked={settings.autoTagAudio} onChange={(e) => change(e.target.checked)} />
        <span>
          <span className="text-sm font-medium">Tag new audio downloads automatically</span>
          <span className="block text-[11px] text-[var(--text-dim)]">
            After an MP3 or FLAC download finishes, OPNduck sends the song's audio fingerprint and title to AcoustID, MusicBrainz and the Cover Art Archive and writes the tags if it is at least 90% sure. Off by default, because it uses the internet; nothing is sent while it is off.
          </span>
        </span>
      </label>
    </div>
  )
}
// --- end: settings/music-tagging ---
