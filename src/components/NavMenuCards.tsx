import { NavLink, useLocation } from 'react-router-dom'
import { motion } from 'framer-motion'
import { NAV_ITEMS } from '../lib/nav'
import { useNavDisplay } from '../lib/navContext'

/**
 * The four menu cards (Home · Downloads · Plugins · Settings) with a single
 * sliding active indicator that glides between cards like the AI-upscaler
 * selector. Icon visibility follows the nav-display mode (text/hybrid/icon).
 */
export default function NavMenuCards({ layoutId = 'nav-active' }: { layoutId?: string }) {
  const { navDisplay } = useNavDisplay()
  const { pathname } = useLocation()

  const activeIndex = (() => {
    const match = NAV_ITEMS.find((i) => (i.end ? pathname === i.to : pathname.startsWith(i.to)))
    return match?.index ?? 0
  })()

  return (
    <div className="flex items-center gap-1.5">
      {NAV_ITEMS.map((item) => {
        const isActive = item.index === activeIndex
        const showIcon = navDisplay !== 'text'
        const showLabel = navDisplay !== 'icon'
        const Icon = item.icon
        return (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            aria-current={isActive ? 'page' : undefined}
            className="relative flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-[var(--text-dim)] transition-colors hover:text-[var(--text)]"
          >
            {isActive && (
              <motion.span
                layoutId={layoutId}
                className="absolute inset-0 rounded-xl bg-[var(--input-bg)] shadow-inner"
                transition={{ type: 'spring', stiffness: 500, damping: 34 }}
              />
            )}
            <span className="relative z-10 flex items-center gap-2">
              {showIcon && <Icon size={20} stroke={1.6} aria-hidden="true" />}
              {showLabel && <span>{item.label}</span>}
            </span>
          </NavLink>
        )
      })}
    </div>
  )
}