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
import { host, type AppSettings, type Recipe } from '../host'
import { FORMATS } from '../features/converter/formats'
import GlassSelect from './GlassSelect'

// @category: settings/watch-folder
/** Settings > Watch folder: new media files dropped into a folder are converted automatically. */
export default function WatchFolderCard() {
  const [watch, setWatch] = useState<AppSettings['watchFolder'] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [recipes, setRecipes] = useState<Recipe[]>([])

  useEffect(() => {
    host.settings?.get().then((s) => setWatch(s.watchFolder))
    void host.recipes.list().then((l) => setRecipes(l.filter((r) => r.input !== 'url')))
  }, [])
  if (!watch) return null

  async function save(patch: Partial<AppSettings['watchFolder']>) {
    setError(null)
    try {
      const next = await host.settings!.set({ watchFolder: patch })
      setWatch(next.watchFolder)
    } catch (err) {
      setError((err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    }
  }
  async function choose() {
    const dir = await host.pickFolder()
    if (dir) void save({ path: dir })
  }

  return (
    <div className="glass rounded-3xl p-5">
      <h2 className="mb-1 text-base font-bold">Watch folder</h2>
      <p className="mb-3 text-xs text-[var(--text-dim)]">
        Drop media files into a folder and OPNduck converts them for you (every 10 seconds while it is running). Results go into a
        “converted” subfolder, and each file is only handled once.
      </p>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="glass-btn px-3 py-1.5 text-xs" onClick={choose}>
            {watch.path ? 'Change folder…' : 'Choose folder…'}
          </button>
          <span className="min-w-0 flex-1 truncate text-xs text-[var(--text-dim)]">{watch.path || 'No folder chosen'}</span>
        </div>
        <div>
          <span className="mb-1 block text-xs font-medium text-[var(--text-dim)]">Convert new files to</span>
          <GlassSelect
            id="watch-container"
            options={FORMATS.map((f) => ({ value: f.id as string, label: f.label }))}
            value={watch.container}
            onChange={(v) => void save({ container: v })}
          />
        </div>
        <div>
          <span className="mb-1 block text-xs font-medium text-[var(--text-dim)]">Or run a recipe on new files</span>
          <GlassSelect
            id="watch-recipe"
            options={[{ value: '', label: 'No, just convert' }, ...recipes.map((r) => ({ value: r.id, label: r.name }))]}
            value={watch.recipe ?? ''}
            onChange={(v) => void save({ recipe: v })}
          />
          {watch.recipe && <span className="mt-1 block text-[11px] text-[var(--text-dim)]">Files the recipe cannot take are skipped. Results go into a “recipe-results” subfolder.</span>}
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" className="accent-[var(--accent)]" checked={watch.enabled} onChange={(e) => void save({ enabled: e.target.checked })} />
          Watch this folder
        </label>
        {error && <span className="text-xs text-red-400">{error}</span>}
      </div>
    </div>
  )
}
// --- end: settings/watch-folder ---
