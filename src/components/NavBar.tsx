import HamburgerMenu from './HamburgerMenu'
import NavMenuCards from './NavMenuCards'
import SocialLinks from './SocialLinks'
import WindowControls from './WindowControls'
import { useNavDisplay } from '../lib/navContext'

/**
 * Unified top navigation bar.
 * Left, in order: the hamburger menu (very first, nearest the left edge) then
 * the social quick-links — neither sits inside a box. Center: the centered
 * OPNduck wordmark. Right: the four menu cards with a sliding active indicator.
 * The strip is a frameless draggable region; interactive children are no-drag.
 */
export default function NavBar() {
  const { navDisplay } = useNavDisplay()
  // In text/icon modes the left cluster sits closer together so the strip
  // doesn't feel sparse on the left; hybrid keeps the airy spacing.
  const divider = navDisplay === 'hybrid' ? 'mx-7' : navDisplay === 'text' ? 'mx-4' : 'mx-3'
  const socials = navDisplay === 'hybrid' ? 'gap-11' : navDisplay === 'text' ? 'gap-5' : 'gap-4'

  return (
    <header className="titlebar-drag sticky top-0 z-40 glass glass-strong">
      <div className="relative flex h-16 items-center justify-between pl-1 pr-0 sm:pl-1.5 sm:pr-1">
        {/* Left: hamburger (utmost) then socials, no boxes */}
        <div className="titlebar-no-drag flex items-center">
          <HamburgerMenu />
          <span className={`hidden h-6 w-px bg-[var(--glass-border)] sm:block ${divider}`} />
          <SocialLinks spacing={socials} />
        </div>

        {/* Centered wordmark — reads visually as "OPNDUCK" with "DUCK" a touch
            larger, carrying a visible gradient + soft glow. The gradient + clip
            are applied to the inline spans so nothing renders as a rectangle.
            Colors come from --accent/--accent-soft/--card-glow so the gradient
            and glow retint per theme (e.g. black & white in Monochrome). */}
        <div
          className="titlebar-no-drag pointer-events-none absolute left-1/2 -translate-x-1/2 select-none whitespace-nowrap text-center text-2xl font-extrabold tracking-wide"
          style={{ filter: 'drop-shadow(0 0 14px var(--card-glow))' }}
        >
          <span
            className="tracking-widest"
            style={{
              background: 'linear-gradient(90deg, var(--accent-soft), var(--accent))',
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              color: 'transparent',
              WebkitTextFillColor: 'transparent',
            }}
          >
            OPN
          </span>
          <span
            className="text-[0.92em] font-bold tracking-wider"
            style={{
              background: 'linear-gradient(90deg, var(--accent), var(--accent-soft))',
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              color: 'transparent',
              WebkitTextFillColor: 'transparent',
            }}
          >
            DUCK
          </span>
        </div>

        {/* Right: the menu cards, then OS window controls when in the shell */}
        <div className="titlebar-no-drag flex items-center gap-4 pr-0">
          <NavMenuCards />
          <WindowControls />
        </div>
      </div>
    </header>
  )
}