import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { featureRegistry } from '../features/registry'

interface PaletteItem {
  id: string
  label: string
  hint?: string
  type: 'route' | 'feature'
  action?: () => string | void
}

/**
 * Command palette — Ctrl+K (Cmd+K on macOS).
 * Searches over routes and installed features/plugins. Glass-styled,
 * theme-aware, keyboard navigable.
 */
export default function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const navigate = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((o) => {
          if (!o) {
            // Reset query + focus when opening.
            setQuery('')
            setActive(0)
            setTimeout(() => inputRef.current?.focus(), 10)
          }
          return !o
        })
      } else if (e.key === 'Escape') {
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const items = useMemo<PaletteItem[]>(() => {
    const routes: PaletteItem[] = [
      { id: 'route-', label: 'Home', hint: 'Dashboard', type: 'route', action: () => '/' },
      { id: 'route-/downloads', label: 'Downloads', type: 'route', action: () => '/downloads' },
      { id: 'route-/plugins', label: 'Plugins', type: 'route', action: () => '/plugins' },
      { id: 'route-/settings', label: 'Settings', type: 'route', action: () => '/settings' },
    ]
    const features: PaletteItem[] = featureRegistry.map((f) => ({
      id: `feature-${f.id}`,
      label: f.title,
      hint: f.tagline,
      type: 'feature',
    }))
    const all = [...routes, ...features]
    if (!query.trim()) return all
    const q = query.toLowerCase()
    return all.filter(
      (i) =>
        i.label.toLowerCase().includes(q) ||
        (i.hint ?? '').toLowerCase().includes(q) ||
        i.id.toLowerCase().includes(q),
    )
  }, [query])

  // Keep the highlighted index valid whenever the filtered list shrinks.
  const safeActive = Math.min(active, Math.max(0, items.length - 1))

  const choose = (item: PaletteItem) => {
    setOpen(false)
    if (item.type === 'route') {
      const to = item.action ? String(item.action()) : '/'
      navigate(to)
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/45 px-4 pt-[18vh] backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setOpen(false)
          }}
        >
          <motion.div
            className="glass glass-strong w-full max-w-xl overflow-hidden rounded-2xl"
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setActive((a) => Math.min(a + 1, items.length - 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setActive((a) => Math.max(a - 1, 0))
              } else if (e.key === 'Enter') {
                e.preventDefault()
                if (items[safeActive]) choose(items[safeActive])
              }
            }}
          >
            <div className="flex items-center gap-3 border-b border-[var(--glass-border)] px-4">
              <span className="text-[var(--text-dim)]">⌕</span>
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search tools, plugins, pages…"
                className="w-full bg-transparent py-3.5 text-sm text-[var(--text)] outline-none placeholder:text-[var(--text-faint)]"
              />
              <kbd className="rounded-md border border-[var(--glass-border)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--text-dim)]">
                ESC
              </kbd>
            </div>
            <ul className="max-h-72 overflow-y-auto p-2">
              {items.length === 0 && (
                <li className="px-3 py-4 text-center text-sm text-[var(--text-dim)]">
                  No results for “{query}”
                </li>
              )}
              {items.map((item, idx) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onMouseEnter={() => setActive(idx)}
                    onClick={() => choose(item)}
                    className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-sm transition-colors ${
                      idx === safeActive
                        ? 'bg-[var(--input-bg)] text-[var(--text)]'
                        : 'text-[var(--text-dim)]'
                    }`}
                  >
                    <span className="font-medium">{item.label}</span>
                    {item.hint && (
                      <span className="text-xs text-[var(--text-faint)]">{item.hint}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
