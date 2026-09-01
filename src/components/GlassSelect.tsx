import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'

export interface GlassSelectOption<T extends string> {
  value: T
  label: string
}

/**
 * A custom glass-styled dropdown (replaces the native <select> which clashes
 * with the Liquid Glass aesthetic). Theme-aware, keyboard navigable,
 * animated with Framer Motion.
 */
export default function GlassSelect<T extends string>({
  options,
  value,
  onChange,
  id,
}: {
  options: GlassSelectOption<T>[]
  value: T
  onChange: (v: T) => void
  id: string
}) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const ref = useRef<HTMLDivElement>(null)

  const selected = options.find((o) => o.value === value)

  const toggle = () => {
    if (!open) setActive(Math.max(0, options.findIndex((o) => o.value === value)))
    setOpen((o) => !o)
  }

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  return (
    <div ref={ref} className="relative w-full">
      <button
        type="button"
        id={id}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={toggle}
        className="glass-input flex w-full items-center justify-between text-left"
      >
        <span className={selected ? '' : 'text-[var(--text-faint)]'}>
          {selected?.label ?? 'Select…'}
        </span>
        <span
          className="text-[var(--text-dim)] transition-transform duration-200"
          style={{ transform: open ? 'rotate(180deg)' : 'none' }}
        >
          ▾
        </span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.ul
            role="listbox"
            className="glass glass-strong absolute left-0 z-40 mt-1.5 w-full max-h-52 overflow-y-auto rounded-xl p-1.5"
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.14, ease: 'easeOut' }}
          >
            {options.map((opt, idx) => (
              <li key={opt.value}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(idx)}
                  onClick={() => {
                    onChange(opt.value)
                    setOpen(false)
                  }}
                  className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors ${
                    active === idx
                      ? 'bg-[var(--input-bg)] text-[var(--text)]'
                      : 'text-[var(--text-dim)]'
                  }`}
                >
                  {opt.label}
                  {opt.value === value && (
                    <span className="text-[var(--accent)]">✓</span>
                  )}
                </button>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  )
}