import HamburgerMenu from './HamburgerMenu'
import NavMenuCards from './NavMenuCards'
import SocialLinks from './SocialLinks'

/**
 * Unified top navigation bar.
 * Left, in order: the hamburger menu (very first, nearest the left edge) then
 * the social quick-links — neither sits inside a box. Center: the centered
 * OPNduck wordmark. Right: the four menu cards with a sliding active indicator.
 * The strip is a frameless draggable region; interactive children are no-drag.
 */
export default function NavBar() {
  return (
    <header className="titlebar-drag sticky top-0 z-40 glass glass-strong">
      <div className="relative mx-auto flex h-16 max-w-[110rem] items-center justify-between px-3 sm:px-5">
        {/* Left: hamburger (utmost) then socials, no boxes */}
        <div className="titlebar-no-drag flex items-center gap-1">
          <HamburgerMenu />
          <span className="mx-1 hidden h-6 w-px bg-[var(--glass-border)] sm:block" />
          <SocialLinks />
        </div>

        {/* Centered wordmark — reads visually as "OPNDUCK" with "DUCK" a touch
            larger, carrying a visible gradient + soft glow. The gradient + clip
            are applied to the inline spans so nothing renders as a rectangle.
            This is the one element allowed a gradient in the Glass theme. */}
        <div
          className="titlebar-no-drag pointer-events-none absolute left-1/2 -translate-x-1/2 select-none whitespace-nowrap text-center text-2xl font-extrabold tracking-wide"
          style={{ filter: 'drop-shadow(0 0 14px rgba(179, 90, 45, 0.45))' }}
        >
          <span
            className="tracking-widest"
            style={{
              background: 'linear-gradient(90deg, #e6975f, #b35a2d)',
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
              background: 'linear-gradient(90deg, #b35a2d, #e6975f)',
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              color: 'transparent',
              WebkitTextFillColor: 'transparent',
            }}
          >
            DUCK
          </span>
        </div>

        {/* Right: the menu cards */}
        <div className="titlebar-no-drag">
          <NavMenuCards />
        </div>
      </div>
    </header>
  )
}