import { version } from '../../package.json'

/**
 * Fixed bottom-right version badge with low opacity.
 * Moved here out of the nav bar per the design direction.
 */
export default function VersionFooter() {
  return (
    <div className="pointer-events-none fixed bottom-2 right-3 z-30 text-[11px] font-medium tracking-wide text-[var(--text-faint)] select-none" style={{ opacity: 0.6 }}>
      v{version}
    </div>
  )
}
