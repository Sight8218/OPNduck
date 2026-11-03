import { useState } from 'react'
import { IconAlertTriangle, IconX } from '@tabler/icons-react'

const GITHUB_URL = 'https://github.com/Sight8218/OPNduck'

/**
 * Yellow "Beta" notice. Shows a disclaimer and links to the GitHub repo
 * so users can report bugs. Dismissible per session.
 */
export default function PreAlphaBanner() {
  const [visible, setVisible] = useState(true)

  if (!visible) return null

  return (
    <div className="mt-2 flex items-start justify-center px-3">
      <div
        className="flex max-w-3xl items-center gap-3 rounded-2xl border px-3 py-1.5 text-xs"
        style={{
          background: 'var(--glass-bg)',
          borderColor: 'var(--glass-border)',
          color: 'var(--text)',
        }}
      >
        <span
          aria-hidden="true"
          className="shrink-0"
        >
          <IconAlertTriangle size={18} />
        </span>
        <p className="leading-snug">
          <strong className="font-bold text-[var(--accent)]">Beta:</strong>{' '}
          <span className="text-[var(--text-dim)]">
            Expect bugs and missing features. Found one? Report it on{' '}
          </span>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-[var(--accent)] underline decoration-[var(--accent)]/40 underline-offset-2 hover:decoration-[var(--accent)]"
          >
            GitHub
          </a>
          <span className="text-[var(--text-dim)]">.</span>
        </p>
        <button
          type="button"
          onClick={() => setVisible(false)}
          aria-label="Dismiss beta notice"
          className="shrink-0 rounded-lg px-2 py-1 text-xs font-bold text-[var(--text-dim)] transition-colors hover:bg-[var(--input-bg)] hover:text-[var(--text)]"
        >
          <IconX size={14} aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}
