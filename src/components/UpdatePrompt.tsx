import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { host, type UpdateCheck } from '../host'
import { getAutoCheck, getSkippedTag, setSkippedTag } from '../lib/updatePrefs'

/**
 * Shown once per launch when GitHub has a newer release than the running app.
 * Notify-only: "Download" opens the release page — OPNduck never replaces itself.
 */
export default function UpdatePrompt() {
  const [info, setInfo] = useState<UpdateCheck | null>(null)

  useEffect(() => {
    if (!host.updates || !getAutoCheck()) return
    let stale = false
    // Wait a few seconds so the check never competes with startup.
    const timer = setTimeout(async () => {
      const result = await host.updates!.check()
      if (stale || !result.newer || !result.latest) return
      if (getSkippedTag() === result.latest.tag) return
      setInfo(result)
    }, 5000)
    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [])

  const latest = info?.latest
  const close = () => setInfo(null)

  return createPortal(
    <AnimatePresence>
      {info && latest && (
        <motion.div
          className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/60 p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Update available"
            className="glass glass-strong flex max-h-[85vh] w-full max-w-lg flex-col gap-4 rounded-3xl p-6"
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
          >
            <div>
              <h2 className="text-lg font-bold">A new version of OPNduck is out</h2>
              <p className="text-sm text-[var(--text-dim)]">
                {latest.tag} is available — you're on v{info.current}. Want to update?
              </p>
            </div>
            {latest.notes && (
              <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-xl bg-[var(--input-bg)] p-3 font-mono text-xs text-[var(--text-dim)]">
                {latest.notes}
              </pre>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                className="rounded-lg border border-[var(--glass-border)] px-3 py-2 text-xs font-medium text-[var(--text-dim)] hover:text-[var(--text)]"
                onClick={() => {
                  setSkippedTag(latest.tag)
                  close()
                }}
              >
                Skip this version
              </button>
              <button
                type="button"
                className="rounded-lg border border-[var(--glass-border)] px-3 py-2 text-xs font-medium text-[var(--text)]"
                onClick={close}
              >
                Later
              </button>
              <button
                type="button"
                className="glass-btn"
                onClick={() => {
                  host.updates?.openRelease(latest.url)
                  close()
                }}
              >
                Download update
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
