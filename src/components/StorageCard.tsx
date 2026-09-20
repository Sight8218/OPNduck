import { useEffect, useState } from 'react'
import { host } from '../host'
import { getDownloadDirOverride, setDownloadDirOverride } from '../lib/downloadPrefs'

const STEP_BTN_CLASS =
  'grid h-8 w-8 place-items-center rounded-lg border border-[var(--glass-border)] bg-[var(--input-bg)] text-sm font-bold text-[var(--text)] transition-colors hover:bg-[var(--input-bg-hover)]'

/**
 * Storage & performance prefs. Download folder is wired to the real desktop
 * folder picker; max concurrent tasks / cache are still placeholders until
 * those systems exist.
 */
// @category: settings/storage-performance
export default function StorageCard() {
  const [maxTasks, setMaxTasks] = useState(2)
  const [override, setOverride] = useState(getDownloadDirOverride())
  const [defaultDir, setDefaultDir] = useState('~/Downloads/OPNduck')

  useEffect(() => {
    if (host.isDesktop) host.tasks.getDefaultDownloadDir().then(setDefaultDir)
  }, [])

  async function browse() {
    const dir = await host.pickFolder()
    if (!dir) return
    setDownloadDirOverride(dir)
    setOverride(dir)
  }

  return (
    <div className="glass rounded-3xl p-5">
      <h2 className="mb-1 text-base font-bold">Storage &amp; Performance</h2>
      <p className="mb-4 text-xs text-[var(--text-dim)]">
        Where downloads land and how much runs at once.
      </p>
      <div className="flex flex-col">
        <div className="flex flex-col gap-2 py-3">
          <span className="text-sm font-medium">Default download folder</span>
          <div className="flex items-center gap-2">
            <input
              className="glass-input flex-1"
              value={override ?? defaultDir}
              readOnly
              aria-label="Default download folder"
            />
            <button
              type="button"
              className="glass-btn shrink-0 px-3 py-2 text-xs"
              onClick={browse}
              disabled={!host.isDesktop}
              title={host.isDesktop ? undefined : 'Folder picker requires the desktop app'}
            >
              Browse
            </button>
            {override && (
              <button
                type="button"
                className="glass-btn shrink-0 px-3 py-2 text-xs"
                onClick={() => {
                  setDownloadDirOverride(null)
                  setOverride(null)
                }}
              >
                Reset
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-3 border-t border-[var(--glass-border)] py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col">
            <span className="text-sm font-medium">Max concurrent tasks</span>
            <span className="text-xs text-[var(--text-dim)]">
              How many downloads/conversions run at the same time.
            </span>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMaxTasks((n) => Math.max(1, n - 1))}
              className={STEP_BTN_CLASS}
              aria-label="Decrease"
            >
              −
            </button>
            <span className="w-4 text-center text-sm font-bold">{maxTasks}</span>
            <button
              type="button"
              onClick={() => setMaxTasks((n) => Math.min(8, n + 1))}
              className={STEP_BTN_CLASS}
              aria-label="Increase"
            >
              +
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-3 border-t border-[var(--glass-border)] py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col">
            <span className="text-sm font-medium">Cache</span>
            <span className="text-xs text-[var(--text-dim)]">Thumbnails and metadata pulled while browsing.</span>
          </div>
          <button type="button" className="glass-btn px-3 py-2 text-xs" disabled title="Nothing cached yet pre-Alpha">
            Clear cache
          </button>
        </div>
      </div>
    </div>
  )
}
// --- end: settings/storage-performance ---
