import { motion } from 'framer-motion'

export interface SelectorOption<T extends string> {
  value: T
  label: string
}

/**
 * Animated segmented control. The active option's highlight "slides" smoothly
 * to its position via a shared `layoutId`, giving a fast but fluid nudge.
 */
export default function SlidingSelector<T extends string>({
  options,
  value,
  onChange,
  id,
  className = '',
}: {
  options: SelectorOption<T>[]
  value: T
  onChange: (v: T) => void
  id: string
  className?: string
}) {
  return (
    <div className={`glass grid rounded-xl p-1 ${className}`}>
      {options.map((opt) => {
        const selected = opt.value === value
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`relative rounded-lg px-2 py-1.5 text-xs font-bold transition-colors ${
              selected ? '' : 'text-[var(--text-dim)] hover:bg-[var(--glass-bg-strong)] hover:text-[var(--text)]'
            }`}
            style={selected ? { color: 'var(--btn-text)' } : undefined}
          >
            {selected && (
              <motion.span
                layoutId={id}
                className="absolute inset-0 rounded-lg"
                style={{ backgroundColor: 'var(--btn-bg)' }}
                transition={{ type: 'spring', stiffness: 500, damping: 32 }}
              />
            )}
            <span className="relative z-10">{opt.label}</span>
          </button>
        )
      })}
    </div>
  )
}
