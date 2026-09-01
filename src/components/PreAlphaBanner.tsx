import { useState } from 'react'

const GITHUB_URL = 'https://github.com/Sight8218/OPNduck'

/**
 * Yellow "Pre-Alpha" notice. Shows a disclaimer and links to the GitHub repo
 * so users can report bugs. Dismissible per session.
 */
export default function PreAlphaBanner() {
  const [visible, setVisible] = useState(true)

  if (!visible) return null

  return (
    <div className="mt-3 flex items-start justify-center px-3">
      <div
        className="flex max-w-3xl items-center gap-3 rounded-2xl border px-4 py-2.5 text-sm"
        style={{
          background: 'rgba(255, 200, 60, 0.14)',
          borderColor: 'rgba(255, 190, 40, 0.4)',
          color: 'var(--text)',
        }}
      >
        <span
          aria-hidden="true"
          className="shrink-0 text-base"
          style={{ filter: 'grayscale(1) brightness(1.4)' }}
        >
          ⚠
        </span>
        <p className="leading-snug">
          <strong className="font-bold text-amber-300">Pre-Alpha:</strong>{' '}
          <span className="text-[var(--text-dim)]">
            This is the shell only — expect bugs and missing features. Found one? Report
            it on{' '}
          </span>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-amber-300 underline decoration-amber-300/40 underline-offset-2 hover:decoration-amber-300"
          >
            GitHub
          </a>
          <span className="text-[var(--text-dim)]">.</span>
        </p>
        <button
          type="button"
          onClick={() => setVisible(false)}
          aria-label="Dismiss pre-alpha notice"
          className="shrink-0 rounded-lg px-2 py-1 text-xs font-bold text-[var(--text-dim)] transition-colors hover:bg-[var(--input-bg)] hover:text-[var(--text)]"
        >
          ✕
        </button>
      </div>
    </div>
  )
}
