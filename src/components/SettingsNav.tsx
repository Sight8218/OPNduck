import { motion } from 'framer-motion'

export interface SettingsCategory {
  id: string
  label: string
  icon: React.ComponentType<{ size?: number; stroke?: number }>
}

/**
 * Left-hand settings navigation, pinned near the left edge. Each category is
 * separated by a divider line and carries a sliding active indicator (shared
 * layoutId) that glides to whichever category becomes active — whether that
 * happened by clicking here or by scrolling the content.
 */
export default function SettingsNav({
  categories,
  activeId,
  onSelect,
}: {
  categories: SettingsCategory[]
  activeId: string
  onSelect: (id: string) => void
}) {
  return (
    <nav
      className="glass sticky top-24 h-fit w-44 shrink-0 rounded-2xl p-2"
      aria-label="Settings sections"
    >
      <ul className="flex flex-col">
        {categories.map((cat, i) => {
          const active = cat.id === activeId
          const Icon = cat.icon
          return (
            <li key={cat.id} className="flex flex-col">
              {i > 0 && <div className="mx-3 my-1.5 h-px bg-[var(--glass-border)]" />}
              <button
                type="button"
                onClick={() => onSelect(cat.id)}
                className="relative flex items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm font-medium text-[var(--text-dim)] transition-colors hover:bg-[var(--glass-bg)] hover:text-[var(--text)]"
              >
                {active && (
                  <motion.span
                    layoutId="settings-cat-active"
                    className="absolute inset-0 rounded-xl bg-[var(--input-bg)] shadow-inner"
                    transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                  />
                )}
                <span className="relative z-10 flex items-center gap-2.5">
                  <Icon size={17} stroke={1.8} aria-hidden="true" />
                  {cat.label}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}