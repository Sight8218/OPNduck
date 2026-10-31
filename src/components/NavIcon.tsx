import type { Icon } from '@tabler/icons-react'

/** Which little animation each menu icon plays while its menu card is hovered or pressed. */
export type NavIconEffect = 'hop' | 'books' | 'plug' | 'spin' | 'pad'

/** Menu icon with a hover animation (CSS, see `.nav-icon-*` in index.css). The card must have the `group` class. */
export default function NavIcon({ icon: Glyph, effect }: { icon: Icon; effect: NavIconEffect }) {
  return (
    <span className="relative inline-flex">
      <Glyph size={20} stroke={1.6} aria-hidden="true" className={`nav-icon nav-icon-${effect}`} />
      {effect === 'plug' && (
        <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" className="nav-spark pointer-events-none absolute -right-2 -top-2" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
          <path d="M10 1v4M15 4l-2.5 2.5M17 9.5h-4M5 4l2.5 2.5M3 9.5h4" />
        </svg>
      )}
    </span>
  )
}
