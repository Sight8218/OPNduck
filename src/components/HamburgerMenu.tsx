import { useEffect, useRef, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { HAMBURGER_ICON, NAV_ITEMS, SOCIALS } from '../lib/nav'

/**
 * Hamburger dropdown (the very first item from the left in the top bar).
 * A classic three-line button that never sits inside a box. Opens a panel that
 * stays open while you interact with it: picking a page navigates without
 * closing, linktree/X/YouTube/TikTok open in new windows. Clicking the button
 * or the backdrop toggles the panel.
 */
export default function HamburgerMenu() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const MenuIcon = HAMBURGER_ICON

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  return (
    <div ref={ref} className="relative">
      {/* No box — outlined three-line glyph, colored by currentColor */}
      <button
        type="button"
        aria-label="Open menu"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((o) => !o)}
        className="grid h-10 w-10 place-items-center rounded-lg text-[var(--text-dim)] transition-all duration-150 hover:scale-110 hover:text-[var(--text)]"
        style={{ filter: 'drop-shadow(0 0 9px rgba(179, 90, 45, 0.18))' }}
      >
        <MenuIcon size={30} stroke={1.7} aria-hidden="true" />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            className="glass glass-strong absolute left-0 top-11 z-50 min-w-60 rounded-2xl p-2"
            initial={{ opacity: 0, x: -8, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
            exit={{ opacity: 0, x: -8, y: -4, scale: 0.98 }}
            transition={{ duration: 0.16, ease: 'easeOut' }}
          >
            <p className="px-3 pb-1 pt-1.5 text-[10px] font-bold uppercase tracking-widest text-[var(--text-faint)]">
              Pages
            </p>
            <div className="mb-1 flex flex-col gap-0.5">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    role="menuitem"
                    className={({ isActive }) =>
                      `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                        isActive
                          ? 'bg-[var(--input-bg)] text-[var(--text)]'
                          : 'text-[var(--text-dim)] hover:bg-[var(--input-bg)] hover:text-[var(--text)]'
                      }`
                    }
                  >
                    <Icon size={18} stroke={1.8} aria-hidden="true" />
                    {item.label}
                  </NavLink>
                )
              })}
            </div>

            <div className="my-1 h-px bg-[var(--glass-border)]" />

            <p className="px-3 pb-1 pt-1 text-[10px] font-bold uppercase tracking-widest text-[var(--text-faint)]">
              Socials
            </p>
            <div className="flex flex-col gap-0.5">
              {SOCIALS.map((s) => (
                <button
                  key={s.url}
                  type="button"
                  role="menuitem"
                  onClick={() => window.open(s.url, '_blank', 'noopener,noreferrer')}
                  className="flex items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium text-[var(--text-dim)] transition-colors hover:bg-[var(--input-bg)] hover:text-[var(--text)]"
                >
                  <img
                     src={s.icon}
                     alt=""
                     aria-hidden="true"
                     className="h-[18px] w-[18px] object-contain"
                     style={{ filter: 'invert(1)' }}
                   />
                  {s.label}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}