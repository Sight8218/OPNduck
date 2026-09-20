import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { NavLink } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { HAMBURGER_ICON, NAV_ITEMS, SOCIALS } from '../lib/nav'

/**
 * Hamburger dropdown (the very first item from the left in the top bar).
 * A classic three-line button that never sits inside a box. Opens a panel that
 * stays open while you interact with it: picking a page navigates without
 * closing, linktree/X/YouTube/TikTok open in new windows. Clicking the button
 * or the backdrop toggles the panel.
 *
 * The panel is portaled to document.body instead of living inside the top
 * bar's own DOM position. The top bar needs `overflow-hidden` (it's a sticky
 * sibling of <main>, not a descendant, so nothing else clips overflow that
 * spills past the window edge) — but overflow-hidden on any ancestor clips
 * ALL descendants' paint, including an absolutely-positioned dropdown, not
 * just the containing block it positions against. Portaling escapes that
 * ancestor chain entirely, the same fix already used for the Settings rail.
 */
export default function HamburgerMenu() {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const buttonWrapRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
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
      const target = e.target as Node
      if (buttonWrapRef.current?.contains(target)) return
      if (menuRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  function toggle() {
    if (!open) {
      const rect = buttonWrapRef.current?.getBoundingClientRect()
      if (rect) setPos({ top: rect.bottom + 4, left: rect.left })
    }
    setOpen((o) => !o)
  }

  return (
    <div ref={buttonWrapRef} className="pl-4">
      {/* No box — outlined three-line glyph, colored by currentColor */}
      <button
        type="button"
        aria-label="Open menu"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={toggle}
        className="grid h-9 w-9 place-items-center rounded-lg text-[var(--text-dim)] transition-all duration-150 hover:scale-110 hover:text-[var(--text)]"
        style={{ filter: 'drop-shadow(0 0 9px var(--card-glow))' }}
      >
        <MenuIcon size={30} stroke={1.7} aria-hidden="true" />
      </button>

      {createPortal(
        <AnimatePresence>
          {open && (
            <motion.div
              ref={menuRef}
              role="menu"
              className="glass-solid fixed z-50 min-w-60 rounded-2xl p-2"
              style={{ top: pos.top, left: pos.left }}
              initial={{ opacity: 0, x: -8, y: -4, scale: 0.98 }}
              animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: -8, y: -4, scale: 0.98 }}
              transition={{ duration: 0.16, ease: 'easeOut' }}
            >
              <p className="px-3 pb-1 pt-1.5 text-xs font-semibold text-[var(--text-faint)]">
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
                      onClick={() => setOpen(false)}
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

              <p className="px-3 pb-1 pt-1 text-xs font-semibold text-[var(--text-faint)]">
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
        </AnimatePresence>,
        document.body,
      )}
    </div>
  )
}
