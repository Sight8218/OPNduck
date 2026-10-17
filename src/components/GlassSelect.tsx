import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { IconCheck, IconChevronDown } from '@tabler/icons-react'

export interface GlassSelectOption<T extends string> {
  value: T
  label: string
}

/**
 * A custom glass-styled dropdown (replaces the native <select> which clashes
 * with the Liquid Glass aesthetic). Theme-aware, keyboard navigable (arrows/Home/End/Enter/Esc),
 * animated with Framer Motion.
 */
export default function GlassSelect<T extends string>({
  options,
  value,
  onChange,
  id,
  disabled,
}: {
  options: GlassSelectOption<T>[]
  value: T
  onChange: (v: T) => void
  id: string
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  // The list is portaled to <body>: cards form their own stacking contexts (transforms,
  // pop-in/hover effects), so an in-card list could be trapped underneath the next
  // card no matter its z-index.
  const [pos, setPos] = useState<{ left: number; width: number; top?: number; bottom?: number } | null>(null)

  const selected = options.find((o) => o.value === value)

  const toggle = () => {
    if (disabled) return
    if (!open) setActive(Math.max(0, options.findIndex((o) => o.value === value)))
    setOpen((o) => !o)
  }

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node
      if (ref.current?.contains(t) || listRef.current?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const r = ref.current?.getBoundingClientRect()
      if (!r) return
      const below = window.innerHeight - r.bottom
      // Flip above the trigger when there isn't room for the 13rem list.
      if (below < 220 && r.top > below) {
        setPos({ left: r.left, width: r.width, bottom: window.innerHeight - r.top + 6 })
      } else {
        setPos({ left: r.left, width: r.width, top: r.bottom + 6 })
      }
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open])

  // Keep the keyboard-highlighted option visible in a scrolling list.
  useEffect(() => {
    if (open) (listRef.current?.children[active] as HTMLElement | undefined)?.scrollIntoView({ block: 'nearest' })
  }, [open, active])

  const choose = (idx: number) => {
    const opt = options[idx]
    if (!opt) return
    onChange(opt.value)
    setOpen(false)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled || options.length === 0) return
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        e.preventDefault()
        if (!open) return toggle()
        const step = e.key === 'ArrowDown' ? 1 : -1
        setActive((a) => (a + step + options.length) % options.length)
        break
      }
      case 'Home':
      case 'End':
        if (open) {
          e.preventDefault()
          setActive(e.key === 'Home' ? 0 : options.length - 1)
        }
        break
      case 'Enter':
      case ' ':
        if (open) {
          e.preventDefault()
          choose(active)
        }
        break
      case 'Escape':
        if (open) {
          e.preventDefault()
          e.stopPropagation()
          setOpen(false)
        }
        break
      case 'Tab':
        setOpen(false)
        break
    }
  }

  return (
    <div ref={ref} className="relative w-full">
      <button
        type="button"
        id={id}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-disabled={disabled}
        onClick={toggle}
        onKeyDown={onKeyDown}
        className={`glass-input flex w-full items-center justify-between text-left ${
          disabled ? 'cursor-not-allowed opacity-50' : ''
        }`}
      >
        <span className={`min-w-0 truncate ${selected ? '' : 'text-[var(--text-faint)]'}`}>
          {selected?.label ?? 'Select…'}
        </span>
        <span
          className="shrink-0 text-[var(--text-dim)] transition-transform duration-200"
          style={{ transform: open ? 'rotate(180deg)' : 'none' }}
        >
          <IconChevronDown size={14} aria-hidden="true" />
        </span>
      </button>

      {createPortal(
      <AnimatePresence>
        {open && pos && (
          <motion.ul
            ref={listRef}
            role="listbox"
            style={{ position: 'fixed', left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom }}
            className="glass glass-strong z-[1000] max-h-52 overflow-y-auto rounded-xl p-1.5"
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
                    <IconCheck size={14} className="text-[var(--accent)]" aria-hidden="true" />
                  )}
                </button>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>,
      document.body,
      )}
    </div>
  )
}