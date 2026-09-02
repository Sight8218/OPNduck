import { useState } from 'react'

/**
 * Storage & performance prefs. Path/limits are display-only placeholders
 * until the desktop shell exposes a real folder picker and task queue —
 * consistent with every other settings card pre-Alpha.
 */
export default function StorageCard() {
  const [maxTasks, setMaxTasks] = useState(2)

  return (
    <div className="glass rounded-3xl p-5">
      <h2 className="mb-1 text-base font-bold">Storage &amp; Performance</h2>
      <p className="mb-4 text-xs text-[var(--text-dim)]">
        Where downloads land and how much runs at once.
      </p>
      <div className="flex flex-col gap-2.5">
        <div className="flex flex-col gap-2 rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-bg)] px-4 py-3">
          <span className="text-sm font-medium">Default download folder</span>
          <div className="flex items-center gap-2">
            <input
              className="glass-input flex-1"
              value="~/Downloads/OPNduck"
              readOnly
              aria-label="Default download folder"
            />
            <button
              type="button"
              className="glass-btn shrink-0 px-3 py-2 text-xs"
              disabled
              title="Folder picker arrives with the desktop shell"
            >
              Browse
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-3 rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-bg)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
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
              className="grid h-8 w-8 place-items-center rounded-lg border border-[var(--glass-border)] bg-[var(--input-bg)] text-sm font-bold text-[var(--text)] transition-colors hover:bg-[var(--input-bg-hover)]"
              aria-label="Decrease"
            >
              −
            </button>
            <span className="w-4 text-center text-sm font-bold">{maxTasks}</span>
            <button
              type="button"
              onClick={() => setMaxTasks((n) => Math.min(8, n + 1))}
              className="grid h-8 w-8 place-items-center rounded-lg border border-[var(--glass-border)] bg-[var(--input-bg)] text-sm font-bold text-[var(--text)] transition-colors hover:bg-[var(--input-bg-hover)]"
              aria-label="Increase"
            >
              +
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-3 rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-bg)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
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
