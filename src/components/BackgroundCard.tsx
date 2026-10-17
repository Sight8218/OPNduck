import SlidingSelector, { type SelectorOption } from './SlidingSelector'
import { useBackgroundStyle, type BackgroundStyle } from '../lib/backgroundPref'

const OPTIONS: SelectorOption<BackgroundStyle>[] = [
  { value: 'flat', label: 'Flat' },
  { value: 'gradient', label: 'Gradient' },
]

/** Appearance setting: solid background colour (default) or the theme's gradient. */
export default function BackgroundCard() {
  const [style, setStyle] = useBackgroundStyle()

  return (
    <div className="glass rounded-3xl p-5">
      <h2 className="mb-1 text-base font-bold text-[var(--text)]">Background</h2>
      <p className="mb-4 text-xs text-[var(--text-dim)]">
        Flat uses one solid colour from your theme. Gradient adds the theme's soft fade.
      </p>
      <SlidingSelector<BackgroundStyle>
        id="background-style"
        options={OPTIONS}
        value={style}
        onChange={setStyle}
        className="w-full grid-cols-2 sm:w-64"
      />
    </div>
  )
}
