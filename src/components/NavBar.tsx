import { useNavigate } from 'react-router-dom'
import HamburgerMenu from './HamburgerMenu'
import NavMenuCards from './NavMenuCards'
import SocialLinks from './SocialLinks'
import WindowControls from './WindowControls'
import { useNavDisplay } from '../lib/navContext'
import PixelLogo from './PixelLogo'
import { unlockArcade } from '../lib/arcadeStore'

/**
 * Unified top navigation bar.
 * Left, in order: the hamburger menu (very first, nearest the left edge) then
 * the social quick-links — neither sits inside a box. Center: the centered
 * OPNduck wordmark. Right: the four menu cards with a sliding active indicator.
 * The strip is a frameless draggable region; interactive children are no-drag.
 */
export default function NavBar() {
  const { navDisplay } = useNavDisplay()
  const navigate = useNavigate()
  // Secret: the wordmark opens the Arcade, and the first click unlocks it for good.
  const openArcade = () => {
    unlockArcade()
    navigate('/arcade')
  }
  // In text/icon modes the left cluster sits closer together so the strip
  // doesn't feel sparse on the left; hybrid keeps the airy spacing.
  const divider = navDisplay === 'hybrid' ? 'mx-7' : navDisplay === 'text' ? 'mx-4' : 'mx-3'
  const socials = navDisplay === 'hybrid' ? 'gap-[clamp(0.5rem,3vw,2.75rem)]' : navDisplay === 'text' ? 'gap-[clamp(0.5rem,1.5vw,1.25rem)]' : 'gap-[clamp(0.5rem,1.2vw,1rem)]'

  return (
    <header className="titlebar-drag sticky top-0 z-40 glass glass-strong overflow-hidden">
      {/* A 3-column grid — not absolute-centering the wordmark over a flex
          row — so the center column reserves its own space. At narrow
          widths the side clusters shrink/clip inside their own column
          instead of visually overlapping the wordmark (previously an
          absolutely-positioned wordmark and the flex side clusters had no
          awareness of each other's width and just crashed together). The
          `overflow-hidden` on the header itself is a hard backstop: it's a
          sibling of <main>, not inside it, so nothing upstream clips it —
          without this, overflow anywhere in here would spill past the
          window's edge instead of just getting cut at this bar's own box. */}
      <div className="grid h-16 grid-cols-[1fr_auto_1fr] items-center pl-1 pr-0 sm:pl-1.5 sm:pr-1">
        {/* Left: hamburger (utmost) then socials, no boxes. Only the socials
            get an overflow-hidden wrapper — HamburgerMenu's dropdown is an
            absolutely-positioned child, and clipping its own ancestor was
            hiding the open menu instead of just the icon row. */}
        <div className="titlebar-no-drag flex min-w-0 items-center">
          <HamburgerMenu />
          <span className={`hidden h-6 w-px shrink-0 bg-[var(--glass-border)] sm:block ${divider}`} />
          {/* p-1.5 gives the icons' hover:scale-110 room to grow on every side
              without getting clipped by this wrapper's own bounds — the
              rightmost icon (Discord) has nothing past it to grow into, so it
              needs the same right-side buffer as the top/bottom. overflow-
              hidden here is only meant to clip width under real crowding. */}
          <div className="min-w-0 overflow-hidden p-1.5">
            <SocialLinks spacing={socials} />
          </div>
        </div>

        <div
          role="presentation"
          onClick={openArcade}
          className="titlebar-no-drag cursor-default select-none whitespace-nowrap px-2 flex items-center"
          style={{ filter: 'drop-shadow(0 0 8px color-mix(in srgb, var(--accent) 45%, transparent))' }}
        >
          <PixelLogo cell={3} />
        </div>

        {/* Right: the menu cards, then OS window controls when in the shell */}
        <div className="titlebar-no-drag flex min-w-0 items-center justify-end gap-4 overflow-hidden py-1.5 pr-0">
          <NavMenuCards />
          <WindowControls />
        </div>
      </div>
    </header>
  )
}