import { useState } from 'react'
import SlidingSelector from './SlidingSelector'

const ON_OFF = [
  { value: 'on' as const, label: 'On' },
  { value: 'off' as const, label: 'Off' },
]

/**
 * Motion & density prefs. Local state only for now (matches every other
 * settings card pre-Alpha) — persistence and actually wiring these into the
 * app's animation/layout code comes with the accessibility pass.
 */
export default function MotionCard() {
  const [reduceMotion, setReduceMotion] = useState<'on' | 'off'>('off')
  const [compact, setCompact] = useState<'on' | 'off'>('off')

  return (
    <div className="glass rounded-3xl p-5">
      <h2 className="mb-1 text-base font-bold">Motion &amp; Density</h2>
      <p className="mb-4 text-xs text-[var(--text-dim)]">
        Trim animations and spacing for a snappier, denser interface.
      </p>
      <div className="flex flex-col gap-2.5">
        <div className="flex flex-col gap-3 rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-bg)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col">
            <span className="text-sm font-medium">Reduce motion</span>
            <span className="text-xs text-[var(--text-dim)]">Cuts page transitions and hover animations to a minimum.</span>
          </div>
          <SlidingSelector
            id="reduce-motion"
            options={ON_OFF}
            value={reduceMotion}
            onChange={setReduceMotion}
            className="w-full grid-cols-2 sm:w-32"
          />
        </div>
        <div className="flex flex-col gap-3 rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-bg)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col">
            <span className="text-sm font-medium">Compact density</span>
            <span className="text-xs text-[var(--text-dim)]">Tighter padding across cards and lists.</span>
          </div>
          <SlidingSelector
            id="compact-density"
            options={ON_OFF}
            value={compact}
            onChange={setCompact}
            className="w-full grid-cols-2 sm:w-32"
          />
        </div>
      </div>
    </div>
  )
}
