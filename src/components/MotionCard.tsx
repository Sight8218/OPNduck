import SlidingSelector from './SlidingSelector'
import { useReduceMotion } from '../lib/motionPrefs'

const ON_OFF = [
  { value: 'on' as const, label: 'On' },
  { value: 'off' as const, label: 'Off' },
]

/**
 * Motion & density prefs — both apply app-wide, see lib/motionPrefs.tsx.
 */
export default function MotionCard() {
  const { reduceMotion, setReduceMotion, compact, setCompact } = useReduceMotion()

  return (
    <div className="glass rounded-3xl p-5">
      <h2 className="mb-1 text-base font-bold">Motion &amp; Density</h2>
      <p className="mb-4 text-xs text-[var(--text-dim)]">
        Trim animations and spacing for a snappier, denser interface.
      </p>
      <div className="flex flex-col">
        <div className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col">
            <span className="text-sm font-medium">Reduce motion</span>
            <span className="text-xs text-[var(--text-dim)]">Turns off animations and hover effects across the app.</span>
          </div>
          <SlidingSelector
            id="reduce-motion"
            options={ON_OFF}
            value={reduceMotion ? 'on' : 'off'}
            onChange={(v) => setReduceMotion(v === 'on')}
            className="w-full grid-cols-2 sm:w-32"
          />
        </div>
        <div className="flex flex-col gap-3 border-t border-[var(--glass-border)] py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col">
            <span className="text-sm font-medium">Compact density</span>
            <span className="text-xs text-[var(--text-dim)]">Tighter padding across cards and lists.</span>
          </div>
          <SlidingSelector
            id="compact-density"
            options={ON_OFF}
            value={compact ? 'on' : 'off'}
            onChange={(v) => setCompact(v === 'on')}
            className="w-full grid-cols-2 sm:w-32"
          />
        </div>
      </div>
    </div>
  )
}
