import SlidingSelector, { type SelectorOption } from './SlidingSelector'
import { useNavDisplay } from '../lib/navContext'
import type { NavDisplay } from '../lib/nav'

const OPTIONS: SelectorOption<NavDisplay>[] = [
  { value: 'text', label: 'Text' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'icon', label: 'Icons' },
]

/**
 * Appearance setting: how the top-bar menu cards show their icon/label.
 *  text-only · hybrid (default) · icons-only.
 */
export default function NavDisplayCard() {
  const { navDisplay, setNavDisplay } = useNavDisplay()

  return (
    <div className="glass rounded-3xl p-5">
      <h2 className="mb-1 text-base font-bold text-[var(--text)]">Menu Icons</h2>
      <p className="mb-4 text-xs text-[var(--text-dim)]">
        How the Home · Downloads · Plugins · Settings cards display.
      </p>
      <SlidingSelector<NavDisplay>
        id="nav-display"
        options={OPTIONS}
        value={navDisplay}
        onChange={setNavDisplay}
        className="w-full grid-cols-3 sm:w-80"
      />
    </div>
  )
}